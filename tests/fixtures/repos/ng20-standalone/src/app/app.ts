import { Component, signal } from '@angular/core';

@Component({ selector: 'app-root', templateUrl: './app.html' })
export class App {
  readonly items = signal<string[]>([]);
}
