const button=document.querySelector('[data-copy]');
const text=document.getElementById('cloud-prompt');
const status=document.getElementById('copy-status');
button.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(text.value);status.textContent='已复制。发给你的云端助手，确认文件读入后再上传现场照。';}
  catch{text.focus();text.select();status.textContent='请长按选中的文字，手动复制后发给云端助手。';}
});
