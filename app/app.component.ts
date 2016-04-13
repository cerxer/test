import {Component} from 'angular2/core';
import {CoursesComponent} from './courses.component'
import {AutherComponent} from './auther.component'

@Component({
    selector: 'my-app',
    template: '<h1>hi ang</h1><courses></courses><authe></authe>',
    directives: [CoursesComponent,AutherComponent]
   
    
})
export class AppComponent { }