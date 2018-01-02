/**
 * @license
 * Copyright 2017 JBoss Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Component, OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation,
} from "@angular/core";

import { FormControl, FormGroup } from "@angular/forms";
import { AbstractControl } from "@angular/forms";
import { Router } from "@angular/router";
import { LoggerService } from "@core/logger.service";
import { ConnectionTableSelectorComponent } from "@dataservices/connection-table-selector/connection-table-selector.component";
import { DataserviceService } from "@dataservices/shared/dataservice.service";
import { DataservicesConstants } from "@dataservices/shared/dataservices-constants";
import { NewDataservice } from "@dataservices/shared/new-dataservice.model";
import { NotifierService } from "@dataservices/shared/notifier.service";
import { Table } from "@dataservices/shared/table.model";
import { VdbStatus } from "@dataservices/shared/vdb-status.model";
import { VdbService } from "@dataservices/shared/vdb.service";
import { VdbsConstants } from "@dataservices/shared/vdbs-constants";
import { WizardService } from "@dataservices/shared/wizard.service";
import { LoadingState } from "@shared/loading-state.enum";
import { WizardComponent } from "patternfly-ng";
import { WizardEvent } from "patternfly-ng";
import { WizardStepConfig } from "patternfly-ng";
import { WizardConfig } from "patternfly-ng";
import { Subscription } from "rxjs/Subscription";

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "app-add-dataservice-wizard",
  templateUrl: "./add-dataservice-wizard.component.html",
  styleUrls: ["./add-dataservice-wizard.component.css"]
})
export class AddDataserviceWizardComponent implements OnInit, OnDestroy {
  public readonly dataserviceSummaryLink: string = DataservicesConstants.dataservicesRootPath;
  public loadingState = LoadingState; // need local ref of enum for html to use

  // Wizard Config
  public wizardConfig: WizardConfig;

  public basicPropertyForm: FormGroup;
  public createComplete = true;
  public createSuccessful = false;

  // Wizard Step 1
  public step1Config: WizardStepConfig;

  // Wizard Step 2
  public step2Config: WizardStepConfig;
  public step2aConfig: WizardStepConfig;
  public step2bConfig: WizardStepConfig;

  @ViewChild("wizard") public wizard: WizardComponent;
  @ViewChild(ConnectionTableSelectorComponent) public tableSelector: ConnectionTableSelectorComponent;

  public nameValidationError = "";
  private dataserviceService: DataserviceService;
  private notifierService: NotifierService;
  private vdbService: VdbService;
  private wizardService: WizardService;
  private logger: LoggerService;
  private router: Router;
  private deploymentChangeSubscription: Subscription;
  private sourceVdbUnderDeployment: string;
  private errorDetailMessage: string;
  private theFinalPageTitle = "";
  private theFinalPageMessage = "";

  constructor(router: Router, dataserviceService: DataserviceService, wizardService: WizardService,
              notifierService: NotifierService, logger: LoggerService, vdbService: VdbService ) {
    this.dataserviceService = dataserviceService;
    this.notifierService = notifierService;
    this.vdbService = vdbService;
    this.wizardService = wizardService;
    this.router = router;
    this.logger = logger;

    this.createBasicPropertyForm();
  }

  /*
   * Initialization
   */
  public ngOnInit(): void {
    // Subscribe to Vdb deployment change messages
    this.deploymentChangeSubscription = this.notifierService.getVdbDeploymentStatus().subscribe((status) => {
      this.onSourceVdbDeploymentStateChanged(status);
    });

    // Step 1 - Select Tables
    this.step1Config = {
      id: "step1",
      priority: 0,
      title: "Select Tables",
      allowClickNav: false
    } as WizardStepConfig;

    // Step 2 - Review and Create
    this.step2Config = {
      id: "step2",
      priority: 0,
      title: this.step2Title,
      allowClickNav: false
    } as WizardStepConfig;
    this.step2aConfig = {
      id: "step2a",
      priority: 0,
      title: "Review",
      allowClickNav: false
    } as WizardStepConfig;
    this.step2bConfig = {
      id: "step2b",
      priority: 1,
      title: this.step2bTitle,
      allowClickNav: false
    } as WizardStepConfig;

    // Wizard Configuration
    this.wizardConfig = {
      embedInPage: true,
      loadingTitle: "Dataservice Wizard loading",
      loadingSecondaryInfo: "Please wait for the wizard to finish loading...",
      title: "Dataservice Wizard",
      contentHeight: "500px",
      done: false
    } as WizardConfig;

    if (this.wizardService.isEdit()) {
      const selectedService = this.dataserviceService.getSelectedDataservice();
      const dsName = selectedService.getId();
      const dsDescr = selectedService.getDescription();
      this.basicPropertyForm.controls["name"].setValue(dsName);
      this.basicPropertyForm.controls["description"].setValue(dsDescr);
      this.basicPropertyForm.get("name").disable();
    } else {
      this.basicPropertyForm.controls["name"].setValue(null);
      this.basicPropertyForm.controls["description"].setValue(null);
    }
    this.setNavAway(false);
  }

  public ngOnDestroy(): void {
    this.deploymentChangeSubscription.unsubscribe();
  }

  // ----------------
  // Public Methods
  // ----------------

  /**
   * Determine if Dataservice is being edited.
   */
  public get isEdit( ): boolean {
    return this.wizardService.isEdit();
  }

  public handleNameChanged( input: AbstractControl ): void {
    const self = this;

    this.dataserviceService.isValidName( input.value ).subscribe(
      ( errorMsg ) => {
      if ( errorMsg ) {
        // only update if error has changed
        if ( errorMsg !== self.nameValidationError ) {
          self.nameValidationError = errorMsg;
        }
      } else { // name is valid
        self.nameValidationError = "";
      }
      self.updatePage2aValidStatus();
    },
  ( error ) => {
      self.logger.error( "[handleNameChanged] Error: %o", error );
    } );
  }

  /*
   * Return the name valid state
   */
  public get nameValid(): boolean {
    return this.nameValidationError == null || this.nameValidationError.length === 0;
  }

  /**
   * Gets the Title to be displayed on the final wizard page
   * @returns {string}
   */
  public get finalPageTitle(): string {
    return this.theFinalPageTitle;
  }

  /**
   * Gets the message to be displayed on the final wizard page
   * @returns {string}
   */
  public get finalPageMessage(): string {
    return this.theFinalPageMessage;
  }

  /*
   * Step 1 instruction message
   */
  public get step1InstructionMessage(): string {
    if (!this.tableSelector.valid) {
      return "Please select tables for the Dataservice";
    } else {
      return "Select tables, then click Next to continue";
    }
  }

  /*
   * Step 2 instruction message
   */
  public get step2InstructionMessage(): string {
    if (this.wizardService.isEdit()) {
      return "Review selections.  Click Update to update the Dataservice";
    }
    return "Review selections and enter a name.  Click Create to create the Dataservice";
  }

  /*
   * Return the name error message if invalid
   */
  public getBasicPropertyErrorMessage( name: string ): string {
    const control: AbstractControl = this.basicPropertyForm.controls[name];
    if (control.invalid) {
      // The first error found is returned
      if (control.errors.required) {
        return name + " is a required property";
      }
    }
    return "";
  }

  public nextClicked($event: WizardEvent): void {
    if ($event.step.config.id === "step1") {
      // TODO implement nextClicked
    }
  }

  public cancelClicked($event: WizardEvent): void {
    const link: string[] = [ DataservicesConstants.dataservicesRootPath ];
    this.logger.log("[AddDataserviceWizardComponent] Navigating to: %o", link);
    this.router.navigate(link).then(() => {
      // nothing to do
    });
  }

  /*
   * Create the Dataservice via komodo REST interface,
   * using the currently entered properties
   */
  public createDataservice(): void {
    // Sets page in progress status
    this.setFinalPageInProgress();

    const sourceVdbName = this.tableSelector.getSelectedTables()[0].getConnection().getId() + VdbsConstants.SOURCE_VDB_SUFFIX;
    this.sourceVdbUnderDeployment = sourceVdbName;

    const self = this;
    this.vdbService
      .deployVdbForTable(this.tableSelector.getSelectedTables()[0])
      .subscribe(
        (wasSuccess) => {
          // Deployment succeeded - wait for source vdb to become active
          if (wasSuccess) {
            self.vdbService.pollForActiveVdb(sourceVdbName, 30, 5);
          } else {
            self.setFinalPageComplete(false);
            self.sourceVdbUnderDeployment = null;
          }
        },
        (error) => {
          self.logger.error("[AddDataserviceWizardComponent] Error: %o", error);
          self.setErrorDetails(error);
          self.setFinalPageComplete(false);
          self.sourceVdbUnderDeployment = null;
        }
      );
  }

  public onDeployDataservice(): void {
    // Start the deployment and then redirect to the dataservice summary page
    this.dataserviceService
      .deployDataservice(this.dataserviceName)
      .subscribe(
        (wasSuccess) => {
          // Nothing to do
        },
        (error) => {
          // Nothing to do
        }
      );

    const link: string[] = [ DataservicesConstants.dataservicesRootPath ];
    this.logger.log("[AddDataserviceWizardComponent] Navigating to: %o", link);
    this.router.navigate(link).then(() => {
      // nothing to do
    });
  }

  /*
   * Listens for the source VDB deployment completion.  If the source VDB is active, proceed with
   * creation of the Dataservice
   * @param status the VDB deployment status
   */
  public onSourceVdbDeploymentStateChanged(status: VdbStatus): void {
    // if null received, ignore
    if (!status || (status.getName() !== this.sourceVdbUnderDeployment) ) {
      return;
      // non-null received, unsubscribe to stop any further notifications
    } else {
      // source VDB state change - no longer watching it's deployment
      this.sourceVdbUnderDeployment = null;
    }

    if (status.isActive()) {
      if (this.wizardService.isEdit()) {
        this.updateDataserviceForSingleTable();
      } else {
        this.createDataserviceForSingleTable();
      }
    } else if (status.isFailed()) {
      this.setFinalPageComplete(false);
    }
  }

  public stepChanged($event: WizardEvent): void {
    if ($event.step.config.id === "step1") {
      this.updatePage1ValidStatus();
      this.wizardConfig.nextTitle = "Next >";
    } else if ($event.step.config.id === "step2a") {
      this.updatePage2aValidStatus();
      if (this.wizardService.isEdit()) {
        this.wizardConfig.nextTitle = "Update";
      } else {
        this.wizardConfig.nextTitle = "Create";
      }
    } else if ($event.step.config.id === "step2b") {
      // Note: The next button is not disabled by default when wizard is done
      this.step2Config.nextEnabled = false;
    } else {
      this.wizardConfig.nextTitle = "Next >";
    }
  }

  /**
   * @returns {string} the name of the dataservice
   */
  public get dataserviceName(): string {
    return this.basicPropertyForm.controls["name"].value;
  }

  /**
   * @returns {string} the description of the dataservice
   */
  public get dataserviceDescription(): string {
    return this.basicPropertyForm.controls["description"].value;
  }

  /**
   * @returns {string} the selected source table names in string form
   */
  public get dataserviceSourceTables(): Table[] {
    return this.tableSelector.getSelectedTables();
  }

  /**
   * Updates the page1 status
   */
  public updatePage1ValidStatus( ): void {
    this.step1Config.nextEnabled = this.tableSelector.valid();
    this.setNavAway(this.step1Config.nextEnabled);
  }

  /**
   * @returns {string} the error details message
   */
  public get errorDetails(): string {
    return this.errorDetailMessage;
  }

  // ----------------
  // Private Methods
  // ----------------

  /*
   * Create the BasicProperty form (page 1)
   */
  private createBasicPropertyForm(): void {
    if (!this.wizardService.isEdit()) {
      this.basicPropertyForm = new FormGroup({
        name: new FormControl( "", this.handleNameChanged.bind( this ) ),
        description: new FormControl("")
      });
      // Responds to basic property changes - updates the page status
      this.basicPropertyForm.valueChanges.subscribe((val) => {
        this.updatePage2aValidStatus( );
      });
    } else {
      this.basicPropertyForm = new FormGroup({
        name: new FormControl( "" ),
        description: new FormControl("")
      });
    }
  }

  private setNavAway(allow: boolean): void {
    this.step1Config.allowNavAway = allow;
  }

  private updatePage2aValidStatus( ): void {
    if (!this.step2aConfig) {
      return;
    }
    if (this.wizardService.isEdit()) {
      this.step2aConfig.nextEnabled = true;
    } else {
      this.step2aConfig.nextEnabled = this.nameValid;
    }
    this.setNavAway(this.step2aConfig.nextEnabled);
  }

  /*
   * Create the Dataservice for the selected source table.  This is invoked
   * only after the source VDB has successfully deployed.
   */
  private createDataserviceForSingleTable(): void {
    const dataservice: NewDataservice = new NewDataservice();

    // Dataservice basic properties from step 1
    dataservice.setId(this.dataserviceName);
    dataservice.setDescription(this.dataserviceDescription);

    const self = this;
    this.dataserviceService
      .createDataserviceForSingleTable(dataservice, this.tableSelector.getSelectedTables()[0])
      .subscribe(
        (wasSuccess) => {
          self.setFinalPageComplete(wasSuccess);
        },
        (error) => {
          self.logger.error("[AddDataserviceWizardComponent] Error: %o", error);
          self.setErrorDetails(error);
          self.setFinalPageComplete(false);
        }
      );
  }

  /**
   * Update the selected Dataservice for the selected source table.  This is invoked
   * only after the source VDB has successfully deployed.
   */
  private updateDataserviceForSingleTable(): void {
    const dataservice: NewDataservice = new NewDataservice();

    // Dataservice basic properties from step 1
    dataservice.setId(this.dataserviceName);
    dataservice.setDescription(this.dataserviceDescription);

    const self = this;
    this.dataserviceService
      .updateDataserviceForSingleTable(dataservice, this.tableSelector.getSelectedTables()[0])
      .subscribe(
        (wasSuccess) => {
          self.setFinalPageComplete(wasSuccess);
        },
        (error) => {
          self.logger.error("[AddDataserviceWizardComponent] Error: %o", error);
          self.setErrorDetails(error);
          self.setFinalPageComplete(false);
        }
      );
  }

  /**
   * Step 2 title - changes based on create or edit
   * @returns {string} step 2 title
   */
  private get step2Title(): string {
    if (this.wizardService.isEdit()) {
      return "Review and Update";
    } else {
      return "Review and Create";
    }
  }

  /**
   * Step 2b title - changes based on create or edit
   * @returns {string} step 2b title
   */
  private get step2bTitle(): string {
    if (this.wizardService.isEdit()) {
      return "Update";
    } else {
      return "Create";
    }
  }

  /**
   * Sets the final page in progress status
   */
  private setFinalPageInProgress(): void {
    this.createComplete = false;
    this.createSuccessful = false;
    if (this.wizardService.isEdit()) {
      this.theFinalPageTitle = "Update in progress";
      this.theFinalPageMessage = "The dataservice is being updated.";
    } else {
      this.theFinalPageTitle = "Creation in progress";
      this.theFinalPageMessage = "The dataservice is being created.";
    }
    this.step2bConfig.nextEnabled = false;
    this.step2bConfig.previousEnabled = false;
  }

  /**
   * Sets the final page completion status
   * @param {boolean} wasSuccessful 'true' if the create or update was successful
   */
  private setFinalPageComplete(wasSuccessful: boolean): void {
    this.createComplete = true;
    this.createSuccessful = wasSuccessful;
    this.step2bConfig.nextEnabled = false;
    this.step2bConfig.previousEnabled = true;
    if (wasSuccessful) {
      if (this.wizardService.isEdit()) {
        this.theFinalPageTitle = "Update was successful";
        this.theFinalPageMessage = "The dataservice was updated successfully. Click on the button to see all dataservices.";
      } else {
        this.theFinalPageTitle = "Creation was successful";
        this.theFinalPageMessage = "The dataservice was created successfully. Click on the button to see all dataservices.";
      }
    } else {
      if (this.wizardService.isEdit()) {
        this.theFinalPageTitle = "Update failed";
        this.theFinalPageMessage = "The dataservice update failed!";
      } else {
        this.theFinalPageTitle = "Creation failed";
        this.theFinalPageMessage = "The dataservice creation failed!";
      }
    }
  }

  /**
   * Sets the error details for the response
   * @param resp the rest call response
   */
  private setErrorDetails( resp: any ): void {
    // Get the error from the response json
    this.errorDetailMessage = "";
    if (resp) {
      try {
        this.errorDetailMessage = resp.json().error;
      } catch {
        this.errorDetailMessage = resp.text();
      }
    }
    // Error visible if message has content
    if (this.errorDetailMessage.length === 0) {
      this.errorDetailMessage = "Please check dataservice entries and retry";
    }
  }

}
