import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const bundle = await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {SignIn} from './admin-src/app/shared/SignIn.tsx'; createRoot(document.getElementById('root')).render(<SignIn session={{authenticated:false,principal:null,capabilities:[],login:{method:'email_password',siteKey:'fictional',googleEnabled:false}}} client={{}} onVerified={async()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});

test('keyboard retry keeps focus in the sign-in form and needs a fresh challenge', async () => {
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:320,height:700}});
  page.on('pageerror', error=>console.error('page error:',error));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(()=>{window.widgets=[];window.turnstile={render(_node,options){window.widgets.push(options);return String(window.widgets.length);},remove(){}};});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>window.widgets.length===1);
  await page.evaluate(()=>window.widgets[0]['error-callback']());
  const retry=page.getByRole('button',{name:'Retry security check'});
  await retry.waitFor();
  await page.getByLabel('Password').focus();
  await page.keyboard.press('Tab');
  assert.equal(await retry.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.widgets.length===2);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Sign-in security check');
  assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.widgets[1].callback('fictional-token'));
  await page.waitForFunction(()=>!document.querySelector('button[type="submit"]').disabled);
  assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).isEnabled(),true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).evaluate(el=>el===document.activeElement),true);
 } finally {await browser.close();}
});
