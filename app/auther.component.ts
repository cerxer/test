import {Component} from 'angular2/core'
import {AutherService} from './auther.service'
import {AutoGrowDirective} from './auto-grow.directive'

@Component({
    selector:'authe',
    template:`<h2>Auther<h2>
    {{title}}
    <input type="text" autoGrow />
    <ul>
    <li *ngFor="#auther of authers">
    {{auther}}
    </li>
    </ul>
    `,
    providers: [AutherService],
    directives:[AutoGrowDirective]
    
})
export class AutherComponent{
    
    title ="yazar";
    authers;
    
    constructor(autherService: AutherService){
       this.authers=autherService.getAuthers(); 
    }
}