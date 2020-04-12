/*
 * This file is generated by jOOQ.
 */
package edu.uci.ics.texera.dataflow.jooqGenerated.tables;


import edu.uci.ics.texera.dataflow.jooqGenerated.Indexes;
import edu.uci.ics.texera.dataflow.jooqGenerated.Keys;
import edu.uci.ics.texera.dataflow.jooqGenerated.Texera;
import edu.uci.ics.texera.dataflow.jooqGenerated.tables.records.UseraccountRecord;

import java.util.Arrays;
import java.util.List;

import javax.annotation.processing.Generated;

import org.jooq.Field;
import org.jooq.ForeignKey;
import org.jooq.Identity;
import org.jooq.Index;
import org.jooq.Name;
import org.jooq.Record;
import org.jooq.Row2;
import org.jooq.Schema;
import org.jooq.Table;
import org.jooq.TableField;
import org.jooq.UniqueKey;
import org.jooq.impl.DSL;
import org.jooq.impl.TableImpl;
import org.jooq.types.UInteger;


/**
 * This class is generated by jOOQ.
 */
@Generated(
    value = {
        "http://www.jooq.org",
        "jOOQ version:3.12.4"
    },
    comments = "This class is generated by jOOQ"
)
@SuppressWarnings({ "all", "unchecked", "rawtypes" })
public class Useraccount extends TableImpl<UseraccountRecord> {

    private static final long serialVersionUID = 2109455247;

    /**
     * The reference instance of <code>texera.useraccount</code>
     */
    public static final Useraccount USERACCOUNT = new Useraccount();

    /**
     * The class holding records for this type
     */
    @Override
    public Class<UseraccountRecord> getRecordType() {
        return UseraccountRecord.class;
    }

    /**
     * The column <code>texera.useraccount.userName</code>.
     */
    public final TableField<UseraccountRecord, String> USERNAME = createField(DSL.name("userName"), org.jooq.impl.SQLDataType.VARCHAR(32).nullable(false), this, "");

    /**
     * The column <code>texera.useraccount.userID</code>.
     */
    public final TableField<UseraccountRecord, UInteger> USERID = createField(DSL.name("userID"), org.jooq.impl.SQLDataType.INTEGERUNSIGNED.nullable(false).identity(true), this, "");

    /**
     * Create a <code>texera.useraccount</code> table reference
     */
    public Useraccount() {
        this(DSL.name("useraccount"), null);
    }

    /**
     * Create an aliased <code>texera.useraccount</code> table reference
     */
    public Useraccount(String alias) {
        this(DSL.name(alias), USERACCOUNT);
    }

    /**
     * Create an aliased <code>texera.useraccount</code> table reference
     */
    public Useraccount(Name alias) {
        this(alias, USERACCOUNT);
    }

    private Useraccount(Name alias, Table<UseraccountRecord> aliased) {
        this(alias, aliased, null);
    }

    private Useraccount(Name alias, Table<UseraccountRecord> aliased, Field<?>[] parameters) {
        super(alias, null, aliased, parameters, DSL.comment(""));
    }

    public <O extends Record> Useraccount(Table<O> child, ForeignKey<O, UseraccountRecord> key) {
        super(child, key, USERACCOUNT);
    }

    @Override
    public Schema getSchema() {
        return Texera.TEXERA;
    }

    @Override
    public List<Index> getIndexes() {
        return Arrays.<Index>asList(Indexes.USERACCOUNT_PRIMARY, Indexes.USERACCOUNT_USERNAME);
    }

    @Override
    public Identity<UseraccountRecord, UInteger> getIdentity() {
        return Keys.IDENTITY_USERACCOUNT;
    }

    @Override
    public UniqueKey<UseraccountRecord> getPrimaryKey() {
        return Keys.KEY_USERACCOUNT_PRIMARY;
    }

    @Override
    public List<UniqueKey<UseraccountRecord>> getKeys() {
        return Arrays.<UniqueKey<UseraccountRecord>>asList(Keys.KEY_USERACCOUNT_USERNAME, Keys.KEY_USERACCOUNT_PRIMARY);
    }

    @Override
    public Useraccount as(String alias) {
        return new Useraccount(DSL.name(alias), this);
    }

    @Override
    public Useraccount as(Name alias) {
        return new Useraccount(alias, this);
    }

    /**
     * Rename this table
     */
    @Override
    public Useraccount rename(String name) {
        return new Useraccount(DSL.name(name), null);
    }

    /**
     * Rename this table
     */
    @Override
    public Useraccount rename(Name name) {
        return new Useraccount(name, null);
    }

    // -------------------------------------------------------------------------
    // Row2 type methods
    // -------------------------------------------------------------------------

    @Override
    public Row2<String, UInteger> fieldsRow() {
        return (Row2) super.fieldsRow();
    }
}
