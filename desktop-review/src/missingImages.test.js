import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareActivities, preparedActivitiesForQueue } from './reviewData.js';
import { restoreTrainingRoute, TRAINING_RETURN_KEY } from './trainingRoute.js';
const base={activity_id:'one',activity_name:'Local class',address:'London',category:'Classes & clubs',archive:false,public_listing_status:'published'};
test('simple missing queue uses the same shared hierarchy and honours manual category artwork',()=>{
  const rows=[base,{...base,activity_id:'two',activity_name:'Other class',reviewed_image_url:'https://e.test/photo.jpg'},
    {...base,activity_id:'three',activity_name:'Third class',use_category_image:true,model_selected_url:'https://e.test/model.jpg',model_selected_confidence:.9},
    {...base,activity_id:'four',activity_name:'Archived',archive:true}];
  assert.deepEqual(preparedActivitiesForQueue(prepareActivities(rows),'missing_images').map(a=>a.activity_id),['one','three']);
});
test('missing deep link survives Google OAuth return without losing the code',()=>{
  let result;
  restoreTrainingRoute({location:{href:'https://test.example/review/?code=a'},sessionStorage:{getItem:k=>k===TRAINING_RETURN_KEY?'https://test.example/review/?view=missing':null,removeItem:()=>{}},history:{replaceState:(_s,_t,url)=>{result=new URL(url);}}});
  assert.equal(result.searchParams.get('view'),'missing'); assert.equal(result.searchParams.get('code'),'a');
});
test('simple review does not prefetch paid searches or display load failure as an empty queue',()=>{
  const app=readFileSync(new URL('./MissingImagesApp.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(app,/action: 'search'|prepare.*[Pp]reload/);
  assert.match(app,/!loading && loaded && !current/); assert.match(app,/Queue not loaded/);
  assert.match(app,/Save photo & next/); assert.match(app,/expected_updated_at: detail.updated_at/);
});
