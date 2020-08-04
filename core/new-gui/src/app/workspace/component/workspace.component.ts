import { ValidationWorkflowService } from './../service/validation/validation-workflow.service';
import { ExecuteWorkflowService } from './../service/execute-workflow/execute-workflow.service';
import { DragDropService } from './../service/drag-drop/drag-drop.service';
import { WorkflowUtilService } from './../service/workflow-graph/util/workflow-util.service';
import { WorkflowActionService } from './../service/workflow-graph/model/workflow-action.service';
import { UndoRedoService } from './../service/undo-redo/undo-redo.service';
import { Component, OnInit } from '@angular/core';

import { OperatorMetadataService } from '../service/operator-metadata/operator-metadata.service';
import { JointUIService } from '../service/joint-ui/joint-ui.service';
import { StubOperatorMetadataService } from '../service/operator-metadata/stub-operator-metadata.service';
import { DynamicSchemaService } from '../service/dynamic-schema/dynamic-schema.service';
import { SourceTablesService } from '../service/dynamic-schema/source-tables/source-tables.service';
import { SchemaPropagationService } from '../service/dynamic-schema/schema-propagation/schema-propagation.service';
import { ResultPanelToggleService } from '../service/result-panel-toggle/result-panel-toggle.service';
import { SaveWorkflowService } from '../service/save-workflow/save-workflow.service';
import { WorkflowStatusService } from '../service/workflow-status/workflow-status.service';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'texera-workspace',
  templateUrl: './workspace.component.html',
  styleUrls: ['./workspace.component.scss'],
  providers: [
    // uncomment this line for manual testing without opening backend server
    // { provide: OperatorMetadataService, useClass: StubOperatorMetadataService },
    OperatorMetadataService,
    DynamicSchemaService,
    SourceTablesService,
    SchemaPropagationService,
    JointUIService,
    WorkflowActionService,
    WorkflowUtilService,
    DragDropService,
    ExecuteWorkflowService,
    UndoRedoService,
    ResultPanelToggleService,
    SaveWorkflowService,
    ValidationWorkflowService,
    WorkflowStatusService,
  ]
})
export class WorkspaceComponent implements OnInit {

  public showResultPanel: boolean = false;

  constructor(
    private resultPanelToggleService: ResultPanelToggleService,

    // list additional services in constructor so they are initialized even if no one use them directly
    private sourceTablesService: SourceTablesService,
    private schemaPropagationService: SchemaPropagationService,
    private saveWorkflowService: SaveWorkflowService,
    private route: ActivatedRoute
  ) {
    this.resultPanelToggleService.getToggleChangeStream().subscribe(
      value => this.showResultPanel = value,
    );
  }

  ngOnInit(): void {
    // check if workflow id is present in the url
    if (this.route.snapshot.params.id) {
      this.saveWorkflowService.fetchWorkflow(this.route.snapshot.params.id);
    }

  }

}
