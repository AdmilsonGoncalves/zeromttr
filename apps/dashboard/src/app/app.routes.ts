import type { Routes } from '@angular/router';
import { WarRoomComponent } from './war-room/war-room.component.js';
import { DecisionComponent } from './decision/decision.component.js';

export const routes: Routes = [
  { path: '', component: WarRoomComponent },
  { path: 'decision/:id', component: DecisionComponent },
  { path: '**', redirectTo: '' }
];
