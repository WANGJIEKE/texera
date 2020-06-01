import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
import { Point } from '../../../types/workflow-common.interface';
import { UndoRedoService } from './../../undo-redo/undo-redo.service';

type JointModelEventInfo = {
  add: boolean,
  merge: boolean,
  remove: boolean,
  changes: {
    added: joint.dia.Cell[],
    merged: joint.dia.Cell[],
    removed: joint.dia.Cell[]
  }
};

// argument type of callback event on a JointJS Model,
// which is a 3-element tuple:
// 1. the JointJS model (Cell) of the event
// 2 and 3. additional information of the event
type JointModelEvent = [
  joint.dia.Cell,
  { graph: joint.dia.Graph, models: joint.dia.Cell[] },
  JointModelEventInfo
];

type JointLinkChangeEvent = [
  joint.dia.Link,
  { x: number, y: number },
  { ui: boolean, updateConnectionOnly: boolean }
];

type JointPositionChangeEvent = [
  joint.dia.Element,
  { x: number, y: number }
];

type JointLayerChangeEvent = [
  joint.dia.Element | joint.dia.Link,
  number
];

type PositionInfo = {
  currPos: Point,
  lastPos: Point | undefined
};

/**
 * JointGraphWrapper wraps jointGraph to provide:
 *  - getters of the properties (to hide the methods that could alther the jointGraph directly)
 *  - event streams of JointGraph in RxJS Observables (instead of the callback functions to fit our use of RxJS)
 *
 * JointJS Graph only contains information related the UI, such as:
 *  - position of operator elements
 *  - events of a cell (operator or link) being dragging around
 *  - events of adding/deleting a link on the UI,
 *      this doesn't necessarily corresponds to adding/deleting a link logically on the graph
 *      because the link might not connect to a target operator while user is dragging the link
 *
 * If an external module needs to access more properties of JointJS graph,
 *  or to make changes **irrelevant** to the graph data structure, but related direcly to the UI,
 *  (such as changing the color of an operator), more methods can be added in this class.
 *
 * For an overview of the services in WorkflowGraphModule, see workflow-graph-design.md
 */
export class JointGraphWrapper {

  // zoom diff represents the ratio that is zoom in/out everytime, for clicking +/- buttons or using mousewheel
  public static readonly ZOOM_CLICK_DIFF: number = 0.05;
  public static readonly ZOOM_MOUSEWHEEL_DIFF: number = 0.01;
  public static readonly INIT_ZOOM_VALUE: number = 1;
  public static readonly INIT_PAN_OFFSET: Point = {x: 0, y: 0};

  public static readonly ZOOM_MINIMUM: number = 0.70;
  public static readonly ZOOM_MAXIMUM: number = 1.30;

  private elementPositions: Map<string, PositionInfo> = new Map<string, PositionInfo>();
  private listenPositionChange: boolean = true;

  // flag that indicates whether multiselect mode is on
  private multiSelect: boolean = false;
  // the currently highlighted operators' IDs
  private currentHighlightedOperators: string[] = [];
  // the currently highlighted groups' IDs
  private currentHighlightedGroups: string[] = [];
  // event stream of highlighting an operator
  private jointOperatorHighlightStream = new Subject<string[]>();
  // event stream of un-highlighting an operator
  private jointOperatorUnhighlightStream = new Subject<string[]>();
  // event stream of highlighting a group
  private jointGroupHighlightStream = new Subject<string[]>();
  // event stream of un-highlighting a group
  private jointGroupUnhighlightStream = new Subject<string[]>();

  // event stream of zooming the jointJS paper
  private workflowEditorZoomSubject: Subject<number> = new Subject<number>();
  // event stream of restoring zoom / offset default of the jointJS paper
  private restorePaperOffsetSubject: Subject<Point> = new Subject<Point>();
  // event stream of panning to make mini-map and main workflow paper compatible in offset
  private panPaperOffsetSubject: Subject<Point> = new Subject<Point>();

  // current zoom ratio
  private zoomRatio: number = JointGraphWrapper.INIT_ZOOM_VALUE;
  // panOffset, a point of panning offset alongside x and y axis
  private panOffset: Point = JointGraphWrapper.INIT_PAN_OFFSET;

  /**
   * This will capture all events in JointJS
   *  involving the 'add' operation
   */
  private jointCellAddStream = Observable
    .fromEvent<JointModelEvent>(this.jointGraph, 'add')
    .map(value => value[0]);

  /**
   * This will capture all events in JointJS
   *  involving the 'change position' operation
   */
  private jointCellDragStream = Observable
    .fromEvent<JointModelEvent>(this.jointGraph, 'change:position')
    .map(value => value[0]);

  /**
   * This will capture all events in JointJS
   *  involving the 'remove' operation
   */
  private jointCellDeleteStream = Observable
    .fromEvent<JointModelEvent>(this.jointGraph, 'remove')
    .map(value => value[0]);


  constructor(private jointGraph: joint.dia.Graph, private undoRedoService: UndoRedoService) {
    // handle if the currently highlighted operator/group is deleted, it should be unhighlighted
    this.handleElementDeleteUnhighlight();

    this.jointCellAddStream.filter(cell => cell.isElement()).subscribe(element => {
      const initPosition = {currPos: (element as joint.dia.Element).position(), lastPos: undefined};
      this.elementPositions.set(element.id.toString(), initPosition);
    });

    this.jointCellDeleteStream.filter(cell => cell.isElement()).subscribe(element =>
      this.elementPositions.delete(element.id.toString()));

    // handle if the currently highlighted operator's position is changed,
    // other highlighted operators should move with it.
    this.handleHighlightedOperatorPositionChange();
  }


  /**
   * This method is used to toggle the multiselect mode.
   * @param multiSelect
   */
  public setMultiSelectMode(multiSelect: boolean): void {
    this.multiSelect = multiSelect;
  }

  /**
   * This method is used to get the current status of the multiselect mode.
   */
  public getMultiSelectMode(): boolean {
    return this.multiSelect;
  }

  /**
   * Gets the operator ID of the current highlighted operators.
   * Returns an empty list if there is no highlighted operator.
   *
   * The returned array is not the original one so that other
   * services/components can't modify it directly.
   */
  public getCurrentHighlightedOperatorIDs(): string[] {
    return Object.assign([], this.currentHighlightedOperators);
  }

  /**
   * Gets the group ID of the current highlighted groups.
   * Returns an empty list if there is no highlighted group.
   *
   * The returned array is not the original one so that other
   * services/components can't modify it directly.
   */
  public getCurrentHighlightedGroupIDs(): string[] {
    return Object.assign([], this.currentHighlightedGroups);
  }

  /**
   * Returns an Observable stream capturing the element position change event in JointJS graph.
   * An element can be an operator or a group.
   *
   * - elementID: the moved element's ID
   * - oldPosition: the element's position before moving
   * - newPosition: where the element is moved to
   */
  public getElementPositionChangeEvent(): Observable<{ elementID: string, oldPosition: Point, newPosition: Point }> {
    return Observable
      .fromEvent<JointPositionChangeEvent>(this.jointGraph, 'change:position').map(e => {
        const elementID = e[0].id.toString();
        const oldPosition = this.elementPositions.get(elementID);
        const newPosition = {x: e[1].x, y: e[1].y};
        if (!oldPosition) {
          throw new Error(`internal error: cannot find element position for ${elementID}`);
        }
        if (!oldPosition.lastPos || oldPosition.currPos.x !== newPosition.x || oldPosition.currPos.y !== newPosition.y) {
          oldPosition.lastPos = oldPosition.currPos;
        }
        this.elementPositions.set(elementID, {currPos: newPosition, lastPos: oldPosition.lastPos});
        return {
          elementID: elementID,
          oldPosition: oldPosition.lastPos,
          newPosition: newPosition
        };
      });
  }

  /**
   * Returns an Observable stream capturing the cell layer change event in JointJS graph.
   * A cell can be an operator, a link, or a group element.
   *
   * - cellID: the moved cell's ID
   * - newPosition: the cell's new layer
   */
  public getCellLayerChangeEvent(): Observable<{ cellID: string, newLayer: number }> {
    return Observable
      .fromEvent<JointLayerChangeEvent>(this.jointGraph, 'change:z').map(e => {
        return {
          cellID: e[0].id.toString(),
          newLayer: e[1]
        };
      });
  }

  /**
   * Highlights the operator with given operatorID.
   * Emits an event to the operator highlight stream.
   * @param operatorID
   */
  public highlightOperator(operatorID: string): void {
    const highlightedOperatorIDs: string[] = [];
    this.highlightElement(operatorID, this.currentHighlightedOperators, highlightedOperatorIDs);
    if (highlightedOperatorIDs.length > 0) {
      this.jointOperatorHighlightStream.next(highlightedOperatorIDs);
    }
  }

  /**
   * Highlights operators in the given list.
   *
   * Emits an event to the operator highlight stream with a list of operatorIDs
   * that are highlighted.
   *
   * @param operatorIDs
   */
  public highlightOperators(operatorIDs: string[]): void {
    const highlightedOperatorIDs: string[] = [];
    operatorIDs.forEach(operatorID =>
      this.highlightElement(operatorID, this.currentHighlightedOperators, highlightedOperatorIDs));
    if (highlightedOperatorIDs.length > 0) {
      this.jointOperatorHighlightStream.next(highlightedOperatorIDs);
    }
  }

  /**
   * Unhighlights the given highlighted operator.
   * Emits an event to the operator unhighlight stream.
   * @param operatorID
   */
  public unhighlightOperator(operatorID: string): void {
    const unhighlightedOperatorIDs: string[] = [];
    this.unhighlightElement(operatorID, this.currentHighlightedOperators, unhighlightedOperatorIDs);
    if (unhighlightedOperatorIDs.length > 0) {
      this.jointOperatorUnhighlightStream.next(unhighlightedOperatorIDs);
    }
  }

  /**
   * Unhighlights operators in the given list.
   *
   * Emits an event to the operator unhighlight stream with a list of operatorIDs
   * that are unhighlighted.
   *
   * @param operatorIDs
   */
  public unhighlightOperators(operatorIDs: string[]): void {
    const unhighlightedOperatorIDs: string[] = [];
    operatorIDs.forEach(operatorID =>
      this.unhighlightElement(operatorID, this.currentHighlightedOperators, unhighlightedOperatorIDs));
    if (unhighlightedOperatorIDs.length > 0) {
      this.jointOperatorUnhighlightStream.next(unhighlightedOperatorIDs);
    }
  }

  /**
   * Highlights the group with given groupID.
   * Emits an event to the group highlight stream.
   * @param groupID
   */
  public highlightGroup(groupID: string): void {
    const highlightedGroupIDs: string[] = [];
    this.highlightElement(groupID, this.currentHighlightedGroups, highlightedGroupIDs);
    if (highlightedGroupIDs.length > 0) {
      this.jointGroupHighlightStream.next(highlightedGroupIDs);
    }
  }

  /**
   * Highlights groups in the given list.
   *
   * Emits an event to the group highlight stream with a list of groupIDs
   * that are highlighted.
   *
   * @param groupIDs
   */
  public highlightGroups(groupIDs: string[]): void {
    const highlightedGroupIDs: string[] = [];
    groupIDs.forEach(groupID =>
      this.highlightElement(groupID, this.currentHighlightedGroups, highlightedGroupIDs));
    if (highlightedGroupIDs.length > 0) {
      this.jointGroupHighlightStream.next(highlightedGroupIDs);
    }
  }

  /**
   * Unhighlights the given highlighted group.
   * Emits an event to the group unhighlight stream.
   * @param groupID
   */
  public unhighlightGroup(groupID: string): void {
    const unhighlightedGroupIDs: string[] = [];
    this.unhighlightElement(groupID, this.currentHighlightedGroups, unhighlightedGroupIDs);
    if (unhighlightedGroupIDs.length > 0) {
      this.jointGroupUnhighlightStream.next(unhighlightedGroupIDs);
    }
  }

  /**
   * Unhighlights groups in the given list.
   *
   * Emits an event to the group unhighlight stream with a list of groupIDs
   * that are unhighlighted.
   *
   * @param groupIDs
   */
  public unhighlightGroups(groupIDs: string[]): void {
    const unhighlightedGroupIDs: string[] = [];
    groupIDs.forEach(groupID =>
      this.unhighlightElement(groupID, this.currentHighlightedGroups, unhighlightedGroupIDs));
    if (unhighlightedGroupIDs.length > 0) {
      this.jointGroupUnhighlightStream.next(unhighlightedGroupIDs);
    }
  }

  /**
   * Gets the event stream of an operator being highlighted.
   */
  public getJointOperatorHighlightStream(): Observable<string[]> {
    return this.jointOperatorHighlightStream.asObservable();
  }

  /**
   * Gets the event stream of an operator being unhighlighted.
   * The operator could be unhighlighted because it's deleted.
   */
  public getJointOperatorUnhighlightStream(): Observable<string[]> {
    return this.jointOperatorUnhighlightStream.asObservable();
  }

  /**
   * Gets the event stream of a group being highlighted.
   */
  public getJointGroupHighlightStream(): Observable<string[]> {
    return this.jointGroupHighlightStream.asObservable();
  }

  /**
   * Gets the event stream of a group being unhighlighted.
   * The group could be unhighlighted because it's deleted.
   */
  public getJointGroupUnhighlightStream(): Observable<string[]> {
    return this.jointGroupUnhighlightStream.asObservable();
  }

  /**
   * Gets the event stream of an element being dragged.
   */
  public getJointElementCellDragStream(): Observable<joint.dia.Element> {
    const jointElementDragStream = this.jointCellDragStream
      .filter(cell => cell.isElement())
      .map(cell => <joint.dia.Element>cell);
    return jointElementDragStream;
  }

  /**
   * Returns an Observable stream capturing the element cell delete event in JointJS graph.
   */
  public getJointElementCellDeleteStream(): Observable<joint.dia.Element> {
    const jointElementDeleteStream = this.jointCellDeleteStream
      .filter(cell => cell.isElement())
      .map(cell => <joint.dia.Element>cell);
    return jointElementDeleteStream;
  }

  /**
   * Returns an Observable stream capturing the link cell add event in JointJS graph.
   *
   * Notice that a link added to JointJS graph doesn't mean it will be added to Texera Workflow Graph as well
   *  because the link might not be valid (not connected to a target operator and port yet).
   * This event only represents that a link cell is visually added to the UI.
   *
   */
  public getJointLinkCellAddStream(): Observable<joint.dia.Link> {
    const jointLinkAddStream = this.jointCellAddStream
      .filter(cell => cell.isLink())
      .map(cell => <joint.dia.Link>cell);

    return jointLinkAddStream;
  }


  /**
   * Returns an Observable stream capturing the link cell delete event in JointJS graph.
   *
   * Notice that a link deleted from JointJS graph doesn't mean the same event happens for Texera Workflow Graph
   *  because the link might not be valid and doesn't exist logically in the Workflow Graph.
   * This event only represents that a link cell visually disappears from the UI.
   *
   */
  public getJointLinkCellDeleteStream(): Observable<joint.dia.Link> {
    const jointLinkDeleteStream = this.jointCellDeleteStream
      .filter(cell => cell.isLink())
      .map(cell => <joint.dia.Link>cell);

    return jointLinkDeleteStream;
  }

  public getPanPaperOffsetStream(): Observable<Point> {
    return this.panPaperOffsetSubject.asObservable();
  }

  /**
   * This method will update the panning offset so that dropping
   *  a new operator will appear at the correct location on the UI.
   *
   * @param panOffset new offset from panning
   */
  public setPanningOffset(panOffset: Point): void {
    this.panOffset = panOffset;
    this.panPaperOffsetSubject.next(panOffset);
  }

  /**
   * This method will update the zoom ratio, which will be used
   *  in calculating the position of the operator dropped on the UI.
   *
   * @param ratio new ratio from zooming
   */
  public setZoomProperty(ratio: number): void {
      this.zoomRatio = ratio;
      this.workflowEditorZoomSubject.next(this.zoomRatio);
  }

  /**
   * Check if the zoom ratio reaches the minimum.
   */
  public isZoomRatioMin(): boolean {
    return this.zoomRatio <= JointGraphWrapper.ZOOM_MINIMUM;
  }

  /**
   * Check if the zoom ratio reaches the maximum.
   */
  public isZoomRatioMax(): boolean {
    return this.zoomRatio >= JointGraphWrapper.ZOOM_MAXIMUM;
  }

  /**
   * Returns an observable stream containing the new zoom ratio
   *  for the jointJS paper.
   */
  public getWorkflowEditorZoomStream(): Observable<number> {
    return this.workflowEditorZoomSubject.asObservable();
  }

  /**
   * This method will fetch current pan offset of the paper.
   */
  public getPanningOffset(): Point {
    return this.panOffset;
  }

  /**
   * This method will fetch current zoom ratio of the paper.
   */
  public getZoomRatio(): number {
    return this.zoomRatio;
  }

  /**
   * This method will restore the default zoom ratio and offset for
   *  the jointjs paper by sending an event to restorePaperSubject.
   */
  public restoreDefaultZoomAndOffset(): void {
    this.setZoomProperty(JointGraphWrapper.INIT_ZOOM_VALUE);
    this.panOffset = JointGraphWrapper.INIT_PAN_OFFSET;
    this.restorePaperOffsetSubject.next(this.panOffset);
  }

  /**
   * Returns an Observable stream capturing the event of restoring
   *  default offset
   */
  public getRestorePaperOffsetStream(): Observable<Point> {
    return this.restorePaperOffsetSubject.asObservable();
  }

  /**
   * Returns an Observable stream capturing the link cell delete event in JointJS graph.
   *
   * Notice that the link change event will be triggered whenever the link's source or target is changed:
   *  - one end of the link is attached to a port
   *  - one end of the link is detached to a port and become a point (coordinate) in the paper
   *  - one end of the link is moved from one point to another point in the paper
   */
  public getJointLinkCellChangeStream(): Observable<joint.dia.Link> {
    const jointLinkChangeStream = Observable
      .fromEvent<JointLinkChangeEvent>(this.jointGraph, 'change:source change:target')
      .map(value => value[0]);

    return jointLinkChangeStream;
  }

  /**
   * This method will get the element position on the JointJS paper.
   * An element can be an operator or a group.
   */
  public getElementPosition(elementID: string): Point {
    const cell: joint.dia.Cell | undefined = this.jointGraph.getCell(elementID);
    if (! cell) {
      throw new Error(`element with ID ${elementID} doesn't exist`);
    }
    if (! cell.isElement()) {
      throw new Error(`${elementID} is not an element`);
    }
    const element = <joint.dia.Element> cell;
    const position = element.position();
    return { x: position.x, y: position.y };
  }

  /**
   * This method repositions the element according to given offsets.
   * An element can be an operator or a group.
   */
  public setElementPosition(elementID: string, offsetX: number, offsetY: number): void {
    const cell: joint.dia.Cell | undefined = this.jointGraph.getCell(elementID);
    if (! cell) {
      throw new Error(`element with ID ${elementID} doesn't exist`);
    }
    if (! cell.isElement()) {
      throw new Error(`${elementID} is not an element`);
    }
    const element = <joint.dia.Element> cell;
    element.translate(offsetX, offsetY);
  }

  /**
   * This method resizes the element according to given width and height.
   * An element can be an operator or a group.
   */
  public setElementSize(elementID: string, width: number, height: number): void {
    const cell: joint.dia.Cell | undefined = this.jointGraph.getCell(elementID);
    if (! cell) {
      throw new Error(`element with ID ${elementID} doesn't exist`);
    }
    if (! cell.isElement()) {
      throw new Error(`${elementID} is not an element`);
    }
    const element = <joint.dia.Element> cell;
    element.resize(width, height);
  }

  /**
   * This method gets the cell's layer (z attribute) on the JointJS paper.
   * A cell can be an operator, a link, or a group element.
   */
  public getCellLayer(cellID: string): number {
    const cell: joint.dia.Cell | undefined = this.jointGraph.getCell(cellID);
    if (! cell) {
      throw new Error(`cell with ID ${cellID} doesn't exist`);
    }
    return cell.attributes.z;
  }

  /**
   * This method sets the cell's layer (z attribute) to the given layer.
   * A cell can be an operator, a link, or a group element.
   */
  public setCellLayer(cellID: string, layer: number): void {
    const cell: joint.dia.Cell | undefined = this.jointGraph.getCell(cellID);
    if (! cell) {
      throw new Error(`cell with ID ${cellID} doesn't exist`);
    }
    cell.set('z', layer);
  }

  /**
   * Returns the boolean value that indicates whether
   * or not listen to operator position change.
   */
  public getListenPositionChange(): boolean {
    return this.listenPositionChange;
  }

  /**
   * Sets the boolean value that indicates whether
   * or not listen to operator position change.
   */
  public setListenPositionChange(listenPositionChange: boolean): void {
    this.listenPositionChange = listenPositionChange;
  }

  /**
   * Highlights the element with given elementID.
   *
   * An element can be either an operator or a group. If the element is already
   * highlighted, the action will be ignored.
   *
   * When the multiselect mode is off:
   * there is only one element that could be highlighted at a time, therefore
   *  if there are other highlighted elements, they will be unhighlighted.
   */
  private highlightElement(elementID: string, currentHighlightedElements: string[], highlightedElements: string[]): void {
    // try to get the element using element ID
    if (!this.jointGraph.getCell(elementID)) {
      throw new Error(`element with ID ${elementID} doesn't exist`);
    }
    // if the element is already highlighted, don't do anything
    if (currentHighlightedElements.includes(elementID)) {
      return;
    }
    // if the multiselect mode is off, unhighlight other highlighted elements first
    if (!this.multiSelect) {
      this.unhighlightOperators(this.getCurrentHighlightedOperatorIDs());
      this.unhighlightGroups(this.getCurrentHighlightedGroupIDs());
    }
    // highlight the element and add it to the list of highlighted elements
    currentHighlightedElements.push(elementID);
    highlightedElements.push(elementID);
  }

  /**
   * Unhighlights the given highlighted element (operator or group).
   */
  private unhighlightElement(elementID: string, currentHighlightedElements: string[], unhighlightedElements: string[]): void {
    if (!currentHighlightedElements.includes(elementID)) {
      return;
    }
    currentHighlightedElements.splice(currentHighlightedElements.indexOf(elementID), 1);
    unhighlightedElements.push(elementID);
  }

  /**
   * Subscribes to element cell delete event stream,
   *  checks if the deleted element is currently highlighted
   *  and unhighlight it if it is.
   */
  private handleElementDeleteUnhighlight(): void {
    this.getJointElementCellDeleteStream().subscribe(deletedElement => {
      const deletedElementID = deletedElement.id.toString();
      if (this.currentHighlightedOperators.includes(deletedElementID)) {
        this.unhighlightOperator(deletedElementID);
      } else if (this.currentHighlightedGroups.includes(deletedElementID)) {
        this.unhighlightGroup(deletedElementID);
      }
    });
  }

  /**
   * Subscribes to operator position change event stream,
   *  checks if the operator is moved by user and if the moved operator is currently highlighted,
   *  if it is, move other highlighted operators along with it.
   */
  private handleHighlightedOperatorPositionChange(): void {
    // TO-DO: incorporate group position change in multi-select
    this.getElementPositionChangeEvent()
      .filter(() => this.listenPositionChange)
      .filter(() => this.undoRedoService.listenJointCommand)
      .filter(movedOperator => this.currentHighlightedOperators.includes(movedOperator.elementID))
      .subscribe(movedOperator => {
        const offsetX = movedOperator.newPosition.x - movedOperator.oldPosition.x;
        const offsetY = movedOperator.newPosition.y - movedOperator.oldPosition.y;
        this.setListenPositionChange(false);
        this.undoRedoService.setListenJointCommand(false);
        this.currentHighlightedOperators
          .filter(operatorID => operatorID !== movedOperator.elementID)
          .forEach(operatorID => this.setElementPosition(operatorID, offsetX, offsetY));
        this.setListenPositionChange(true);
        this.undoRedoService.setListenJointCommand(true);
      });
  }

}
