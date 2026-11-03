import { NgModule } from '@angular/core';
import { IonButton, IonCheckbox, IonContent, IonIcon, IonInput, IonItem, IonLabel, IonList, IonSelect, IonSelectOption, IonSpinner, IonTextarea } from '@ionic/angular';

// Ionic v9 exports standalone components from the package root; this small
// compatibility module keeps page imports readable while retaining tree-shaking.
const components = [IonButton, IonCheckbox, IonContent, IonIcon, IonInput, IonItem, IonLabel, IonList, IonSelect, IonSelectOption, IonSpinner, IonTextarea];

@NgModule({ imports: components, exports: components })
export class IonicComponentsModule {}
