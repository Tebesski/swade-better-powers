import assert from 'node:assert/strict';
import test from 'node:test';
import {castOptionChoices} from '../scripts/cast-options.mjs';

test('casting options preserve template-only modifiers, versions and raises alongside power rules',()=>{
 const old=globalThis.game;
 const item={flags:{'swade-better-powers':{powerModifiers:[{id:'same',name:'Power',options:[{id:'power',cost:1}]}],powerRaises:[{level:1,changes:[]}]}}};
 globalThis.game={modules:{get:id=>id==='swade-better-templates'?{api:{readCastAutomation:()=>({modifiers:[{id:'same',name:'Template',options:[{id:'template',cost:2}]},{id:'only-template',name:'Area',options:[{id:'area',cost:3}]}],raises:[{level:2}]})}}:undefined}};
 try{
  const choices=castOptionChoices(item);
  assert.deepEqual(choices.modifiers.map(mod=>mod.id),['same','only-template']);
  assert.deepEqual(choices.modifiers[0].options.map(option=>option.id),['power','template']);
  assert.deepEqual(choices.raises.map(raise=>raise.level),[1,2]);
 }finally{globalThis.game=old}
});
