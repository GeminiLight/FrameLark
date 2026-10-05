import test from 'node:test';
import assert from 'node:assert/strict';
import { localDesignReply, normalizeDesignReply } from '../../apps/studio/public/design-agent.js';

test('design actions only expose safe existing controls and valid crops', () => {
  const response = normalizeDesignReply({reply:'试一组光线调整。',principle:'保护高光。',action:{
    kind:'adjustment',label:'微调',changes:[
      {key:'exposure',value:9},{key:'highlights',value:-90},{key:'highlights',value:10},{key:'not-a-control',value:5}
    ]
  }});
  assert.deepEqual(response.action.changes,[{key:'exposure',value:.4},{key:'highlights',value:-25}]);
  assert.equal(normalizeDesignReply({action:{kind:'style',presetId:'invented'}}).action.kind,'none');
  assert.equal(normalizeDesignReply({action:{kind:'crop',crop:{x:.8,y:.1,width:.7,height:.7}}}).action.kind,'none');
  assert.equal(normalizeDesignReply({action:{kind:'region',changes:[{key:'vignette',value:20}]}}).action.kind,'none');
});

test('marked area advice uses measured light and offers a reversible region edit', () => {
  const answer = localDesignReply('请看标记处',{focusAnnotation:{number:2,note:'这里太亮',rect:{x:.2,y:.2,width:.3,height:.3}},regionStats:{region:{mean:.72},whole:{mean:.48}}});
  assert.match(answer.reply,/第 2 处/);
  assert.match(answer.reply,/比整张照片平均更亮/);
  assert.equal(answer.action.kind,'region');
  assert.equal(answer.action.changes[0].key,'highlights');
  const brighter = localDesignReply('请看标记处',{focusAnnotation:{number:1,note:'想让这里更亮'},regionStats:{region:{mean:.2,saturation:.1},whole:{mean:.5,saturation:.2}}});
  assert.equal(brighter.action.kind,'region');
  assert.equal(brighter.action.changes[0].key,'shadows');
});

test('local guide grounds crop and light replies in the existing photo analysis', () => {
  const analysis = {
    summary:'天空明亮，前景偏暗。',
    cropRecommendation:{reason:'右侧边缘有干扰。',rect:{x:.05,y:.05,width:.85,height:.82}},
    recommendations:[{id:'light',reason:'天空明亮，先收高光。',lesson:'先看亮部。',adjustments:{exposure:.08,highlights:-16,shadows:11}}]
  };
  const crop = localDesignReply('这张要裁剪吗？',{analysis,source:'local',subject:'landscape'});
  assert.match(crop.reply,/右侧边缘有干扰/);
  assert.equal(crop.action.kind,'crop');
  const light = localDesignReply('暗部怎样调？',{analysis,source:'local',subject:'landscape'});
  assert.match(light.reply,/天空明亮，先收高光/);
  assert.equal(light.action.kind,'adjustment');
  assert.equal(light.action.changes[1].key,'highlights');
  const naturalMood = localDesignReply('更有情绪，但保持自然',{analysis,source:'local',subject:'landscape',recommendedStyle:'golden-hour'});
  assert.equal(naturalMood.action.presetId,'open-road');
  const quiet = localDesignReply('再安静一点',{analysis,source:'local',subject:'landscape'});
  assert.equal(quiet.action.presetId,'misty-air');
});
