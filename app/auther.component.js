System.register(['angular2/core', './auther.service', './auto-grow.directive'], function(exports_1, context_1) {
    "use strict";
    var __moduleName = context_1 && context_1.id;
    var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
        var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
        if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
        else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
        return c > 3 && r && Object.defineProperty(target, key, r), r;
    };
    var __metadata = (this && this.__metadata) || function (k, v) {
        if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
    };
    var core_1, auther_service_1, auto_grow_directive_1;
    var AutherComponent;
    return {
        setters:[
            function (core_1_1) {
                core_1 = core_1_1;
            },
            function (auther_service_1_1) {
                auther_service_1 = auther_service_1_1;
            },
            function (auto_grow_directive_1_1) {
                auto_grow_directive_1 = auto_grow_directive_1_1;
            }],
        execute: function() {
            AutherComponent = (function () {
                function AutherComponent(autherService) {
                    this.title = "yazar";
                    this.authers = autherService.getAuthers();
                }
                AutherComponent = __decorate([
                    core_1.Component({
                        selector: 'authe',
                        template: "<h2>Auther<h2>\n    {{title}}\n    <input type=\"text\" autoGrow />\n    <ul>\n    <li *ngFor=\"#auther of authers\">\n    {{auther}}\n    </li>\n    </ul>\n    ",
                        providers: [auther_service_1.AutherService],
                        directives: [auto_grow_directive_1.AutoGrowDirective]
                    }), 
                    __metadata('design:paramtypes', [auther_service_1.AutherService])
                ], AutherComponent);
                return AutherComponent;
            }());
            exports_1("AutherComponent", AutherComponent);
        }
    }
});
//# sourceMappingURL=auther.component.js.map