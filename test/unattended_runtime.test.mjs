import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import Vec3 from 'vec3';
import { gameOnline } from '../src/agent/vision/game_health.js';

test('a rendering HTTP listener cannot make a disconnected bot healthy', () => {
    for (const bot of [null, {}, {entity:{position:{}}, _poisoned:true},
        {entity:{position:{}}, _client:{ended:true, state:'play'}}]) assert.equal(gameOnline(bot), false);
    assert.equal(gameOnline({entity:{position:{}}, _client:{state:'play',ended:false}}), true);
});

test('short missions hit their absolute deadline even with continuous inventory changes', () => {
    const context = vm.createContext({console, Date, setTimeout, clearTimeout,
        process:{env:{MC_ADMIN_MISSION_WALL_MS:'1000'}}, wsServer:{}});
    const source=readFileSync(new URL('../src/agent/admin_mission.js',import.meta.url),'utf8')
        .replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
    vm.runInContext(source,context);
    const Mission=vm.runInContext('AdminMission',context);
    const mission=new Mission({bot:{},self_prompter:{}});
    mission.state='RUNNING';
    mission.mission={startedAt:Date.now()-2000, deadlineAt:Date.now()+300000};
    let ended;
    mission.end=reason=>{ended=reason;};
    mission._maybeExtendDeadline=()=>{throw new Error('absolute deadline must precede extension');};
    mission.tick();
    assert.equal(ended,'deadline');
});

test('food-enabled missions let survival preempt work and report blocked goals', () => {
    const context = vm.createContext({console, Date, setTimeout, clearTimeout,
        process:{env:{MC_FOOD_INSTINCTS:'1'}}, wsServer:{}});
    const source=readFileSync(new URL('../src/agent/admin_mission.js',import.meta.url),'utf8')
        .replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
    vm.runInContext(source,context);
    const Mission=vm.runInContext('AdminMission',context);
    const prompt=new Mission({})._loopPrompt('制作工具');
    assert.match(prompt,/优先脱险和补充食物/);
    assert.match(prompt,/!cannotComplete/);
    assert.doesNotMatch(prompt,/饥饿已停用/);
});

test('covered bot assembles stocked tools locally without spending a surface-climb budget', async t => {
    t.mock.timers.enable({apis:['setTimeout']});
    const original=process.cwd();
    const directory=mkdtempSync(path.join(os.tmpdir(),'neko-kit-'));
    mkdirSync(path.join(directory,'bots','_supervisor'),{recursive:true});
    let replenish;
    try {
        process.chdir(directory);
        replenish=(await import(pathToFileURL(path.join(original,'bots','_supervisor','skills','replenishKit.js')).href+'?kit-test')).default;
    } finally { process.chdir(original); }
    t.after(()=>{
        const resolved=path.resolve(directory);
        if (!resolved.startsWith(path.resolve(os.tmpdir())+path.sep) || !path.basename(resolved).startsWith('neko-kit-')) throw new Error('unsafe temporary path');
        rmSync(resolved,{recursive:true,force:true});
    });
    const stock={spruce_planks:20,cobblestone:9,stick:6};
    const counts=()=>({...stock});
    const calls=[];
    const bot={entity:{position:new Vec3(0,72,0)}, time:{timeOfDay:6000}, entities:{}, health:20,food:20,
        inventory:{emptySlotCount:()=>20,items:()=>Object.entries(stock).filter(([,n])=>n>0).flatMap(([name,count])=>
            name.endsWith('_pickaxe') ? Array.from({length:count},()=>({name,count:1})) : [{name,count}])},
        blockAt:()=>({name:'stone',boundingBox:'block'})};
    const craft=async(_,name,n=1)=>{
        if(name==='crafting_table') stock.spruce_planks-=4*n;
        else if(name==='stone_pickaxe'){stock.cobblestone-=3*n;stock.stick-=2*n;}
        else if(name==='stick'){stock.spruce_planks-=2*n;stock.stick+=4*n;return true;}
        else throw new Error('unexpected recipe: '+name);
        stock[name]=(stock[name]||0)+n;return true;
    };
    const result=await replenish(bot,{log:()=>{},world:{getInventoryCounts:counts,getNearestBlock:()=>null,
        getNearestBlocksWhereAsync:async()=>[]},skills:{craftRecipeLocal:craft,craftRecipe:craft,
            customSkill:async(_,name)=>{calls.push(name);return false;}}});
    assert.equal(stock.stone_pickaxe,3);
    assert.equal(stock.crafting_table,1);
    assert.ok(result.progressed);
    assert.ok(!calls.includes('surfaceUp'),'local materials should be used before climbing');
});
