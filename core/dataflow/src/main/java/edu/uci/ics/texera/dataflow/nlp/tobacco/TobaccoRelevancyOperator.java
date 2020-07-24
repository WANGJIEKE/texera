package edu.uci.ics.texera.dataflow.nlp.tobacco;

import edu.uci.ics.texera.api.constants.DataConstants;
import edu.uci.ics.texera.api.constants.ErrorMessages;
import edu.uci.ics.texera.api.constants.SchemaConstants;
import edu.uci.ics.texera.api.dataflow.IOperator;
import edu.uci.ics.texera.api.exception.DataflowException;
import edu.uci.ics.texera.api.exception.TexeraException;
import edu.uci.ics.texera.api.field.IField;
import edu.uci.ics.texera.api.field.IntegerField;
import edu.uci.ics.texera.api.schema.AttributeType;
import edu.uci.ics.texera.api.schema.Schema;
import edu.uci.ics.texera.api.tuple.Tuple;
import edu.uci.ics.texera.api.utils.Utils;
import org.apache.arrow.flight.*;
import org.apache.arrow.memory.RootAllocator;
import org.apache.arrow.vector.*;
import org.apache.arrow.vector.types.pojo.ArrowType;
import org.apache.arrow.vector.types.pojo.Field;
import org.apache.arrow.vector.types.pojo.FieldType;
import org.jooq.meta.derby.sys.Sys;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;

import static java.util.Arrays.asList;

public class TobaccoRelevancyOperator implements IOperator {
    private final TobaccoRelevancyPredicate predicate;
    private IOperator inputOperator;
    private Schema outputSchema;

    private List<Tuple> tupleBuffer;
    Queue<Integer> resultQueue;

    private int cursor = CLOSED;

    private final static String PYTHON = "python3";
    private final static String PYTHONSCRIPT = Utils.getResourcePath("tobacco_relevancy_classify.py", DataConstants.TexeraProject.TEXERA_DATAFLOW).toString();

    //Default nltk training model set to be "Senti.pickle"
    private final String VectorizerPath;
    private final String ClassifierPath;

    // For now it is fixed, but in the future should deal with arbitrary tuple and schema.
    // Related to Apache Arrow.
    private final static org.apache.arrow.vector.types.pojo.Schema tupleToPythonSchema =
            new org.apache.arrow.vector.types.pojo.Schema(Collections.singletonList(
                    new Field("text", FieldType.nullable(new ArrowType.Utf8()), null)));

    // Flight related
    private final static Location location = new Location(URI.create("grpc+tcp://localhost:5005"));
    private final static RootAllocator rootAllocator = new RootAllocator();
    private FlightClient flightClient = null;

    public TobaccoRelevancyOperator(TobaccoRelevancyPredicate predicate){
        this.predicate = predicate;

        String VectorizerFileName = predicate.getInputAttributeVectorizerModel();
        if (VectorizerFileName == null) {
            VectorizerFileName = "tobacco_cv.sav";
        }
        this.VectorizerPath = Utils.getResourcePath(VectorizerFileName, DataConstants.TexeraProject.TEXERA_DATAFLOW).toString();

        String ClassifierFileName = predicate.getInputAttributeClassifierModel();
        if (ClassifierFileName == null) {
            ClassifierFileName = "tobacco_model.sav";
        }
        this.ClassifierPath = Utils.getResourcePath(ClassifierFileName, DataConstants.TexeraProject.TEXERA_DATAFLOW).toString();

    }

    public void setInputOperator(IOperator operator) {
        if (cursor != CLOSED) {
            throw new TexeraException("Cannot link this operator to another operator after the operator is opened");
        }
        this.inputOperator = operator;
    }

    /*
     * add a new field to the schema, with name resultAttributeName and type String
     */
    private Schema transformSchema(Schema inputSchema){
        Schema.checkAttributeExists(inputSchema, predicate.getInputAttributeName());
        Schema.checkAttributeNotExists(inputSchema, predicate.getResultAttributeName());
        return new Schema.Builder().add(inputSchema).add(predicate.getResultAttributeName(), AttributeType.INTEGER).build();
    }

    /**
     * When this operator is opened, it executes the python script, which constructs a {@code FlightServer}
     * object which is then up and running in the specified address. The operator calls
     * {@code flightClient.doAction(new Action("healthcheck"))} to check the status of the server, and then proceeds if
     * successful (otherwise there will be an exception).
     * @throws TexeraException
     */
    @Override
    public void open() throws TexeraException {
        if (cursor != CLOSED) {
            return;
        }
        if (inputOperator == null) {
            throw new DataflowException(ErrorMessages.INPUT_OPERATOR_NOT_SPECIFIED);
        }

        List<String> args = new ArrayList<>(Arrays.asList(PYTHON, PYTHONSCRIPT, VectorizerPath, ClassifierPath));
        ProcessBuilder processBuilder = new ProcessBuilder(args).inheritIO();
        try {
            // Start Flight server (Python process)
            Process process = processBuilder.start();
            // wait for it to be alive.
            while (!process.isAlive()) ;
            // Connect to server
            boolean connected = false;
            while (!connected) {
                try {

                    flightClient = FlightClient.builder(rootAllocator, location).build();
                    String message = new String(
                            flightClient.doAction(new Action("healthcheck")).next().getBody(), StandardCharsets.UTF_8);
                    connected = message.equals("Flight Server is up and running!");
                } catch (Exception e) {
                    System.out.println("Flight Client:\tNot connected to the server in this try.");
                    flightClient.close();
                }
            }
        } catch (Exception e) {
            throw new DataflowException(e.getMessage(), e);
        }

        inputOperator.open();
        Schema inputSchema = inputOperator.getOutputSchema();

        // generate output schema by transforming the input schema
        outputSchema = transformToOutputSchema(inputSchema);

        cursor = OPENED;
    }

    /**
     * For every batch, the operator calls {@code flightClient.doAction(new Action("compute"))} to tell the server to
     * compute sentiments of the specific table that was sent earlier. The server executes computation,
     * and returns back a success message when computation is finished.
     * @return Whether the buffer is empty
     */
    private boolean computeTupleBuffer() {
        tupleBuffer = new ArrayList<Tuple>();
        int i = 0;
        while (i < predicate.getBatchSize()){
            Tuple inputTuple;
            if ((inputTuple = inputOperator.getNextTuple()) != null) {
                tupleBuffer.add(inputTuple);
                i++;
            } else {
                break;
            }
        }
        if (tupleBuffer.isEmpty()) {
            return false;
        }
        writeArrowStream(tupleBuffer);
        return true;
    }

    @Override
    public Tuple getNextTuple() throws TexeraException {
        if (cursor == CLOSED) {
            return null;
        }
        if (tupleBuffer == null){
            if (computeTupleBuffer()) {
                computeClassLabel();
            } else {
                return null;
            }
        }
        return popupOneTuple();
    }

    // Process the data file using NLTK
    private void computeClassLabel() {
        try{
//            System.out.println("Flight Client:\t" + new String(
            boolean success = false;
            while (!success) {
                try {
                    FlightInfo info = flightClient.getInfo(FlightDescriptor.path(Collections.singletonList("ToPython")));
                    flightClient.doAction(new Action("compute")).next().getBody();
                } catch (Exception e) {
                    continue;
                }
                success = true;
            }
//                    , StandardCharsets.UTF_8));
            resultQueue = new LinkedList<>();
            readArrowStream();
        }catch(Exception e){
            throw new DataflowException(e.getMessage(), e);
        }
    }

    private Tuple popupOneTuple() {
        Tuple outputTuple = tupleBuffer.get(0);
        tupleBuffer.remove(0);
        if (tupleBuffer.isEmpty()) {
            tupleBuffer = null;
        }

        List<IField> outputFields = new ArrayList<>();
        outputFields.addAll(outputTuple.getFields());

        Integer className = resultQueue.remove();
        outputFields.add(new IntegerField( className ));
        return new Tuple(outputSchema, outputFields);
    }

    /**
     * When all the batches are finished and the operator closes, it issues a
     * {@code flightClient.doAction(new Action("shutdown"))} call to shut down the server, and also closes the client.
     * @throws TexeraException
     */
    @Override
    public void close() throws TexeraException {
        try {
            flightClient.doAction(new Action("shutdown")).next();
            flightClient.close();
        } catch (InterruptedException e) {
            throw new DataflowException(e.getMessage(), e);
        }
        if (cursor == CLOSED) {
            return;
        }
        if (inputOperator != null) {
            inputOperator.close();
        }
        cursor = CLOSED;
    }

    @Override
    public Schema getOutputSchema() {
        return this.outputSchema;
    }

    public Schema transformToOutputSchema(Schema... inputSchema) {

        if (inputSchema.length != 1)
            throw new TexeraException(String.format(ErrorMessages.NUMBER_OF_ARGUMENTS_DOES_NOT_MATCH, 1, inputSchema.length));

        // check if the input schema is presented
        if (! inputSchema[0].containsAttribute(predicate.getInputAttributeName())) {
            throw new TexeraException(String.format(
                    "input attribute %s is not in the input schema %s",
                    predicate.getInputAttributeName(),
                    inputSchema[0].getAttributeNames()));
        }

        // check if the attribute type is valid
        AttributeType inputAttributeType =
                inputSchema[0].getAttribute(predicate.getInputAttributeName()).getType();
        boolean isValidType = inputAttributeType.equals(AttributeType.STRING) ||
                inputAttributeType.equals(AttributeType.TEXT);
        if (! isValidType) {
            throw new TexeraException(String.format(
                    "input attribute %s must have type String or Text, its actual type is %s",
                    predicate.getInputAttributeName(),
                    inputAttributeType));
        }

        return transformSchema(inputSchema[0]);
    }

    private void vectorizeTupleToPython(Tuple tuple, int index, VectorSchemaRoot schemaRoot) {
        ((VarCharVector) schemaRoot.getVector("text")).setSafe(
                index, tuple.getField(predicate.getInputAttributeName()).getValue().toString().getBytes(StandardCharsets.UTF_8)
        );
    }

    /**
     * For every batch, the operator converts list of {@code Tuple}s into Arrow stream data in almost the exact same
     * way as it would when using Arrow file, except now it sends stream to the server with
     * {@link FlightClient#startPut(org.apache.arrow.flight.FlightDescriptor, org.apache.arrow.vector.VectorSchemaRoot,
     * org.apache.arrow.flight.FlightClient.PutListener, org.apache.arrow.flight.CallOption...)} and {@link
     * FlightClient.ClientStreamListener#putNext()}. The server uses {@code do_put()} to receive data stream
     * and convert it into a {@code pyarrow.Table} and store it in the server.
     * @param values The buffer of tuples to write.
     */
    private void writeArrowStream(List<Tuple> values) {
//        System.out.print("Flight Client:\tSending data to Python...");
        SyncPutListener flightListener = new SyncPutListener();
        VectorSchemaRoot schemaRoot = VectorSchemaRoot.create(tupleToPythonSchema, rootAllocator);
        FlightClient.ClientStreamListener streamWriter = flightClient.startPut(
                FlightDescriptor.path(Collections.singletonList("ToPython")), schemaRoot, flightListener);
        int index = 0;
        while (index < values.size()) {
            schemaRoot.allocateNew();
            int chunkIndex = 0;
            while (chunkIndex < predicate.getChunkSize() && index + chunkIndex < values.size()) {
                vectorizeTupleToPython(values.get(index + chunkIndex), chunkIndex, schemaRoot);
                chunkIndex++;
            }
            schemaRoot.setRowCount(chunkIndex);
            streamWriter.putNext();
            index += chunkIndex;
            schemaRoot.clear();
        }
        streamWriter.completed();
//        System.out.println(" Done.");
    }


    /**
     * For every batch, the operator gets the computed sentiment result by calling
     * {@link FlightClient#getStream(org.apache.arrow.flight.Ticket, org.apache.arrow.flight.CallOption...)}.
     * The reading and conversion process is the same as what it does when using Arrow file.
     */
    private void readArrowStream() {
//        System.out.print("Flight Client:\tReading data from Python...");
        FlightInfo info = flightClient.getInfo(FlightDescriptor.path(Collections.singletonList("FromPython")));
        Ticket ticket = info.getEndpoints().get(0).getTicket();
        FlightStream stream = flightClient.getStream(ticket);
        while (stream.next()) {
            VectorSchemaRoot root  = stream.getRoot(); // get root
            List<FieldVector> fieldVector = root.getFieldVectors();
            BigIntVector predVector = ((BigIntVector) fieldVector.get(0));
            for (int j = 0; j < predVector.getValueCount(); j++) {
                Integer label = (int) predVector.get(j);
                resultQueue.add(label);
            }
        }
//        System.out.println(" Done.");
    }
}

