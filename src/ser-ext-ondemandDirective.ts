//#region imports
import * as template                    from "text!./ser-ext-ondemandDirective.html";
import { utils,
         logging,
         directives }                   from "./node_modules/davinci.js/dist/umd/daVinci";
import { ISerConfig,
         ISerReport,
         ISerGeneral,
         ISerConnection,
         ISerTemplate}                  from "./node_modules/ser.api/index";
import { isNull }                       from "util";
import "css!./ser-ext-ondemandDirective.css";
//#endregion

export enum SelectionMode {
	Normal = 0,
	OnDemandOff = 1,
	OnDemandOn = 2,
}
export enum SelectionType {
	Static = 0,
	Dynamic = 1,
}

//#region enums
enum SERState {
    running,
    finished,
    ready,
    error,
    serNotRunning,
    serNoConnectionQlik,
    noProperties
}

enum EVersionOption {
    all
}

enum ETaskOption {
    all
}
//#endregion

//#region interfaces

interface ISERRequestStart extends ISerConfig {
    onDemand: boolean;
}

interface ISerReportExtended extends ISerReport {
    distribute: ISERDistribute;
}

interface ISERResponseStart {
    status: number;
    taskId: string;
}

interface ISERResponseStatusVersion {
    name: string;
    version: string;
}

interface ISERResponseStatus {
    status: number;
    log: string;
    link: string;
    taskId: string;
    versions: ISERResponseStatusVersion[];
}

interface ISERRequestStatus {
    taskId?: string;
    versions?: EVersionOption | string;
    tasks?: ETaskOption | string;
}

interface ISERDistribute {
    hub: ISERHub;
}

interface ISERHub {
    mode: string;
    connections: string;
}

interface IProperties {
    template: string;
    output: string;
    selection: number;
    directDownload: boolean;
}

interface INxAppPropertiesExtended extends EngineAPI.INxAppProperties {
    published: boolean;
}

interface IGenericBookmarkLayoutMetaExtended extends EngineAPI.INxMetaTitleDescription {
    published: boolean;
    privileges: string[];
    approved: boolean;
    title: string;
}

interface IGenericBookmarkExtended extends EngineAPI.IGenericBookmark {
    id: string;
}
//#endregion

class OnDemandController implements ng.IController {

    //#region variables
    invalid: boolean = false;
    appId: string;
    appPublished: boolean;
    bookmarkName: string = "serBookmarkOnDemand";
    clicked: boolean = false;
    actionRunable: boolean = false;
    editMode: boolean;
    element: JQuery;
    host: string;
    interval: NodeJS.Timer;
    intervalShort: number = 3000;
    intervalLong: number = 6000;
    link: string;
    noPropertiesSet: boolean = true;
    properties: IProperties = {
        template: " ",
        output: " ",
        selection: 0,
        directDownload: false
    };
    username: string;
    running: boolean = false;
    sheetId: string;
    title: string = "Generate Report";
    tempContentLibIndex: number;
    taskId: string;
    timeout: ng.ITimeoutService;
    timeoutAfterStop: number = 2000;
    //#endregion

    //#region logger
    private _logger: logging.Logger;
    private get logger(): logging.Logger {
        if (!this._logger) {
            try {
                this._logger = new logging.Logger("OnDemandController");
            } catch (error) {
                console.error("ERROR in create logger instance", error);
            }
        }
        return this._logger;
    }
    //#endregion

    //#region state
    private _state : SERState;
    public get state() : SERState {
        if (typeof(this._state)!=="undefined") {
            return this._state;
        }
        return SERState.ready;
    }
    public set state(v : SERState) {
        if (v !== this._state) {

            this.logger.debug("STATE: ", v);

            if (this.noPropertiesSet) {
                v = SERState.noProperties;
            }

            this._state = v;

            switch (v) {
                case SERState.ready:
                    this.running = false;
                    this.clicked = false;
                    this.actionRunable = true;
                    setTimeout(() => {
                        this.link = null;
                    }, 1000);
                    this.title  = "Generate Report";
                    break;

                case SERState.running:
                    this.running = true;
                    this.actionRunable = true;
                    this.title  = "Running ... (click to abort)";
                    break;

                case SERState.finished:

                    this.running = false;
                    this.clicked = false;
                    this.actionRunable = true;

                    this.title  = "Download Report";
                    if (this.properties.directDownload) {
                        this.action();
                    }

                    this.clearInterval();
                    this.setInterval(this.intervalLong);
                    break;

                case SERState.serNotRunning:
                    this.running = false;
                    this.clicked = false;
                    this.actionRunable = false;
                    this.title  = "SER not available";
                    break;

                case SERState.serNoConnectionQlik:
                    this.running = false;
                    this.clicked = false;
                    this.actionRunable = false;
                    this.title = "SER no connection to Qlik";
                    break;

                case SERState.noProperties:
                    this.running = false;
                    this.clicked = false;
                    this.actionRunable = false;
                    this.title = "No Properties selected";
                    break;

                default:
                    this.running = false;
                    this.clicked = false;
                    this.actionRunable = true;
                    this.title = "Error while running - Retry";
                    break;
            }
        }
    }
    //#endregion

    //#region model
    private _model: EngineAPI.IGenericObject;
    get model(): EngineAPI.IGenericObject {
        return this._model;
    }
    set model(value: EngineAPI.IGenericObject) {
        if (value !== this._model) {
            try {
                this._model = value;
                this.model.app.getAppLayout()
                    .then((res) => {
                        this.appId = res.qFileName;
                    })
                .catch((error) => {
                    this.logger.error("ERROR", error);
                });

                var that = this;
                value.on("changed", function () {
                    value.getProperties()
                        .then((res) => {

                            if (that.tempContentLibIndex !== res.properties.templateContentLibrary) {
                                res.properties.template = null;
                            }

                            that.tempContentLibIndex = res.properties.templateContentLibrary;


                            that.logger.debug("CHANGED", res);

                            if(isNull(res.properties.template)) {
                                that.noPropertiesSet = true;
                                that.state = SERState.noProperties;
                            } else {
                                that.noPropertiesSet = false;
                                that.state = SERState.ready;
                            }
                            that.setProperties(res.properties);
                        })
                        .catch( (error) => {
                            this.logger.error("ERROR in setter of model ", error);
                    });
                });
                value.emit("changed");
            } catch (error) {
                this.logger.error("ERROR in setter of model", error);
            }
        }
    }
    //#endregion

    $onInit(): void {
        this.logger.debug("initialisation from BookmarkController");
    }

    $onDestroy(): void {
        try {
            this.clearInterval();
        } catch {
            this.logger.debug("could not clear interval onDestroy");
        }
    }

    static $inject = ["$timeout", "$element", "$scope"];

    /**
     * init of the controller for the Directive
     * @param timeout
     * @param element
     * @param scope
     */
    constructor(timeout: ng.ITimeoutService, element: JQuery, scope: ng.IScope) {

        this.element = element;
        this.timeout = timeout;

        let hostArr: Array<string> = ((this.model as any).session.rpc.url as string).split("/");
        this.host = `${hostArr[0]==="wss:"?"https":"http"}://${hostArr[2]}${hostArr[3]!=="app"?"/"+hostArr[3]:""}`;

        let arrProm: Promise<void>[] = [];
        arrProm.push(this.getUsername());
        arrProm.push(this.getIsPublished());

        this.getSheetId()
        .catch((error) => {
            this.logger.info("no sheet found");
            throw error;
        });

        Promise.all(arrProm)
        .then(() => {
            this.invalid = true;
            this.logger.info(this.username);
        })
        .catch((error) => {
            this.logger.error("error in constructor", error);
        });


        this.getStatus(this.taskId);
        this.setInterval(this.intervalLong);
    }

    //#region private function
    private getUsername(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.model.app.evaluateEx("=OSUser()")
            .then((res) => {
                let uArr = res.qText.split(";");
                this.username = `${uArr[0].split("=")[1]}/${uArr[1].split("=")[1]}`;
                this.bookmarkName = `serBookmarkOnDemand-${this.username}`;
                resolve();
            })
            .catch((error) => {
                this.logger.error("error while getting user", error);
                this.bookmarkName = "serBookmarkOnDemand";
                reject();
            });
        });
    }

    private getSheetId(): Promise<void> {
        return new Promise((resolve, reject) => {

            this.model.app.getAllInfos()
            .then((allInfo) => {
                let sheets: EngineAPI.INxInfo[] = [];
                for (const info of allInfo) {
                    if (info.qType === "sheet") {
                        sheets.push(info);
                    }
                }
                for (const sheet of sheets) {
                    let sheetObject: EngineAPI.IGenericObject;
                    this.model.app.getObject(sheet.qId)
                    .then((res) => {
                        sheetObject = res;
                        return res.getFullPropertyTree();
                    })
                    .then((res) => {
                        for (const iterator of res.qChildren) {
                            if (iterator.qProperty.qInfo.qId === this.model.id) {
                                this.sheetId = sheetObject.id;
                            }
                        }
                        resolve();
                    })
                    .catch((error) => {
                        Promise.reject(error);
                    });
                }
            })
            .catch((error) => {
                this.logger.error("error in get sheet id", error);
                this.sheetId = "default";
                reject();
            });
        });
    }

    private getIsPublished(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.model.app.getAppProperties()
            .then((appProperties: INxAppPropertiesExtended) => {
                this.appPublished = false;
                if(typeof(appProperties.published) !=="undefined") {
                    this.appPublished = appProperties.published;
                }
                resolve();
            })
            .catch((error) => {
                this.logger.error("error in if sheet is published", error);
                reject();
            });
        });
    }

    private setInterval(intervalTime: number): void {
        this.logger.debug("fcn: setInterfal");
        this.interval = setInterval(() => {
            this.getStatus(this.taskId);
        }, intervalTime);
    }

    private clearInterval(): void {
        this.logger.debug("fcn: clearInterval");
        clearInterval(this.interval);
    }

    private createRequest(bookmarkId: string): ISERRequestStart {
        this.logger.debug("fcn: createRequest");
        let general: ISerGeneral = {
            useUserSelections: SelectionMode.OnDemandOn
        };
        let connection: ISerConnection;
        let template: ISerTemplate = {
            input: this.properties.template,
            output: "OnDemand",
            outputFormat: this.properties.output
        };

        switch (this.properties.selection) {
            case 0:
                connection = {
                    app: this.appId,
                    sharedSession: true
                };
                general.useUserSelections = SelectionMode.OnDemandOn;
                break;

            case 1:
                connection = {
                    app: this.appId,
                    sharedSession: false
                };
                general.useUserSelections = SelectionMode.OnDemandOff;
                template = {
                    input: this.properties.template,
                    output: "OnDemand",
                    outputFormat: this.properties.output,
                    selections: [{
                        type: SelectionType.Static,
                        objectType: "hiddenbookmark",
                        values: [bookmarkId]
                    }]
                };
                break;

            default:
                general.useUserSelections = SelectionMode.Normal;
                connection = {
                    app: this.appId,
                    sharedSession: false
                };
                break;
        }

        let report: ISerReportExtended = {
            general: general,
            connections: [connection],
            template: template,
            distribute: {
                hub: {
                    connections: "@CONFIGCONNECTION@",
                    mode: "Override"
                }
            }
        };

        return {
            onDemand: true,
            tasks: [{
                reports: [report]
            }]
        };
    }

    private start (): void {
        this.logger.debug("fcn: start");
        if (this.properties.selection !== 1) {
            this.runSerStartCommand("")
            .catch((error) => {
                this.logger.error("ERROR in createReport", error);
            });
        } else {
            this.createBookmark()
            .then((bookmarkId) => {
                return this.runSerStartCommand(bookmarkId);
            })
            .catch((error) => {
                this.logger.error("ERROR in createReport", error);
            });
        }
    }

    private runSerStartCommand(bookmarkId: string): Promise<void> {
        this.logger.debug("fcn: runSerStrartCommand");
        return new Promise((resolve, reject) => {

            let requestJson: ISERRequestStart = this.createRequest(bookmarkId);
            let serCall: string = `SER.Start('${JSON.stringify(requestJson)}')`;
            this.logger.debug("Json for SER.start command: ", serCall);

            this.model.app.evaluate(serCall)
            .then((response) => {
               let statusObject: ISERResponseStart;
               this.logger.debug("Response from SER.Start: ", response);
                try {
                    statusObject = JSON.parse(response);
                } catch (error) {
                    this.logger.error("error", error);
                }
                this.logger.debug("taskId:", statusObject.taskId);
                this.logger.debug("Status:", statusObject.status);

                if(typeof(statusObject) === "undefined" || statusObject.taskId === "-1") {
                    this.logger.debug("in defined error block from SER.Start");
                    this.title = "Wrong Task ID - Retry";
                    return;
                }

                if (statusObject.status === -1) {
                    this.state = SERState.serNoConnectionQlik;
                }

                this.logger.debug("set Task ID");
                this.taskId = statusObject.taskId;
                this.state = SERState.running;

                this.clearInterval();
                this.setInterval(this.intervalShort);
                resolve();
            })
            .catch((error) => {
                reject(error);
            });
        });
    }

    private createBookmark (): Promise<string> {
        this.logger.debug("fcn: createBookmark");
        return new Promise((resolve, reject) => {

            let bookmarkId: string = "";
            let bookmarkProperties: EngineAPI.IGenericBookmarkProperties =  {
                qInfo: {
                    qType: "hiddenbookmark"
                },
                qMetaDef: {
                    title: this.bookmarkName,
                    approved: false
                },
                sheetId: this.sheetId,
                creationDate: (new Date()).toISOString()
            };

            this.model.app.getBookmarks({
                qTypes: ["hiddenbookmark"],
                qData: {}
            })
            .then((bookmarks) => {
                let proms: Promise<void>[] = [];
                let bookmarksTyped: EngineAPI.INxContainerEntry<any>[] = bookmarks as any;
                for (const bookmark of bookmarksTyped) {
                    try {
                        let meta: IGenericBookmarkLayoutMetaExtended = bookmark.qMeta as IGenericBookmarkLayoutMetaExtended;
                        if (meta.title === this.bookmarkName) {
                            proms.push(this.destroyExistingBookmark(bookmark.qInfo.qId));
                        }
                    } catch {
                        // if the bookmark is not correct, just do nothing
                    }
                }
                return Promise.all(proms);
            })
            .then(() => {
                this.logger.debug("bookmark properties", bookmarkProperties);
                return this.model.app.createBookmark(bookmarkProperties);
            })
            .then((bookmarkObject: IGenericBookmarkExtended) => {
                bookmarkId = bookmarkObject.id;

                switch (this.appPublished) {
                    case true:
                        this.logger.debug("app is published");
                        return bookmarkObject.publish();

                    default:
                        this.logger.debug("app is in my work");
                        return this.model.app.doSave();
                }
            })
            .then(() => {
                resolve(bookmarkId);
            })
            .catch((error) => {
                this.logger.error("ERROR in create Bookmark", error);
                reject(error);
            });
        });
    }

    private destroyExistingBookmark(id: string): Promise<void> {
        this.logger.debug("fcn: destroyExistingBookmark", id);
        return new Promise((resolve, reject) => {
            let obj: EngineAPI.IGenericBookmark;
            this.model.app.getBookmark(id)
            .then((object) => {
                obj = object;
                this.logger.debug("fcn: destroyExistingBookmark - bevor getLayout");

                return obj.getLayout();
            })
            .then((layout) => {
                this.logger.debug("fcn: destroyExistingBookmark - layout bookmark", layout);
                try {
                    let meta: IGenericBookmarkLayoutMetaExtended = layout.qMeta as IGenericBookmarkLayoutMetaExtended;
                    if(typeof(meta.published)!=="undefined"
                    && typeof(meta.privileges)!=="undefined"
                    && meta.privileges.indexOf("publish")!==-1
                    && !meta.approved) {
                        this.logger.debug("fcn: destroyExistingBookmark - bevor unpublish", layout);
                        return obj.unPublish();
                    }
                } catch (error) {
                    reject(error);
                }
            })
            .then(() => {
                return obj.getLayout();
            })
            .then((layout) => {
                try {
                    let meta: IGenericBookmarkLayoutMetaExtended = layout.qMeta as IGenericBookmarkLayoutMetaExtended;
                    if (typeof(meta.privileges)!=="undefined"
                    && meta.privileges.indexOf("delete")!==-1) {
                        this.logger.debug("fcn: destroyExistingBookmark - bevor destroyBookmark");
                        return this.model.app.destroyBookmark(id);
                    }
                } catch (error) {
                    reject(error);
                }
            })
            .then((res) => {
                this.logger.info("Status from delete", res);
                resolve();
            })
            .catch((error) => {
                this.logger.error("ERROR in destroyExistingBookmark", error);
                reject(error);
            });
        });
    }

    private setProperties (properties: IProperties): Promise<void> {
        this.logger.debug("fcn: setProperties");
        return new Promise((resolve, reject) => {
            try {
                this.properties.template = properties.template;
                this.properties.selection = properties.selection;
                this.properties.output = properties.output;
                this.properties.directDownload = properties.directDownload;
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    private getStatus (taskId: string) {
        this.logger.debug("fcn: getStatus");
        let reqestJson: ISERRequestStatus = {};
        if (typeof(taskId)!=="undefined") {
            reqestJson = {
                "taskId": `${taskId}`
            };
        } else {
            reqestJson = {
                "versions": EVersionOption[EVersionOption.all]
            };
        }

        let serCall: string = `SER.Status('${JSON.stringify(reqestJson)}')`;
        this.logger.debug("call fcn getStatus", serCall);

        this.model.app.evaluate(serCall)
            .then((response) => {
                let statusObject: ISERResponseStatus;
                this.logger.debug("response from status call", response);

                try {
                    if (response.indexOf("Error in expression")!==-1) {
                        this.logger.warn(response);
                        this.state = SERState.serNotRunning;
                        return;
                    }
                } catch (error) {
                    this.logger.error("ERROR", error);
                    return;
                }

                try {
                    statusObject = JSON.parse(response);
                } catch (error) {
                    this.logger.error("Error log from SER: ", response);
                    this.state = SERState.error;
                }

                if(typeof(statusObject.taskId)!=="undefined") {
                    this.taskId = statusObject.taskId;
                }

                this.logger.debug("statusObject.Status", statusObject.status);

                switch (statusObject.status) {
                    case -2:
                        this.state = SERState.serNoConnectionQlik;
                        break;
                    case -1:
                        this.state = SERState.error;
                        break;
                    case 0:
                        this.state = SERState.ready;
                        this.logger.info("SER Status is ready");
                        break;
                   case 1:
                        this.state = SERState.running;
                        break;
                    case 2:
                        this.state = SERState.running;
                        break;
                    case 3:
                        this.link = `${this.host}${statusObject.link}`;
                        this.state = SERState.finished;
                        break;

                    default:
                        this.state = SERState.error;
                        break;
                }
            })
        .catch((error) => {
            this.state = SERState.serNotRunning;
            this.logger.error("ERROR", error);
        });
    }

    private stopReport() {
        this.logger.debug("fcn: stopReport");
        let reqestJson: ISERRequestStatus = {
           "taskId": `${this.taskId}`
        };

        let serCall: string = `SER.Stop('${JSON.stringify(reqestJson)}')`;

        this.logger.debug("call fcn abortReport", serCall);
        this.model.app.evaluate(serCall)
            .then(() => {
              this.logger.debug("report generation aborted");
            })
        .catch((error) => {
            this.logger.error("ERROR in abortRepot", error);
            this.state = SERState.error;
        });
    }
    //#endregion

    //#region public functions

    /**
     * controller function for click actions
     */
    public action () {
        this.logger.debug("fcn: action");
        if (this.state === 4) {
            return;
        }
        switch (this.state) {
            case SERState.ready:
                this.clicked = true;
                this.running = true;
                this.title = "Running ... (click to abort)";
                this.start();
                break;
            case SERState.running:
                this.title = "Aborting ... ";
                this.stopReport();
                break;
            case SERState.finished:
                this.title = "Generate Report";
                this.state = SERState.ready;
                window.open(this.link, "_blank");
                this.stopReport();
                break;

            default:
                this.clicked = true;
                this.stopReport();
                this.title = "Running ... (click to abort)";
                setTimeout(() => {
                    this.start();
                }, this.timeoutAfterStop);
                break;
        }
    }

    /**
     * isEditMode
     */
    public isEditMode(): boolean {
        this.logger.trace("fcn: isEditMode");
        if (this.editMode) {
            return true;
        }
        return false;
    }
    //#endregion

}

export function OnDemandDirectiveFactory(rootNameSpace: string): ng.IDirectiveFactory {
    "use strict";
    return ($document: ng.IAugmentedJQuery, $injector: ng.auto.IInjectorService, $registrationProvider: any) => {
        return {
            restrict: "E",
            replace: true,
            template: utils.templateReplacer(template, rootNameSpace),
            controller: OnDemandController,
            controllerAs: "vm",
            scope: {},
            bindToController: {
                model: "<",
                theme: "<?",
                editMode: "<?"
            },
            compile: ():void => {
                utils.checkDirectiveIsRegistrated($injector, $registrationProvider, rootNameSpace,
                    directives.IdentifierDirectiveFactory(rootNameSpace), "Identifier");
                utils.checkDirectiveIsRegistrated($injector, $registrationProvider, rootNameSpace,
                    directives.ShortCutDirectiveFactory(rootNameSpace), "Shortcut");
            }
        };
    };
}
