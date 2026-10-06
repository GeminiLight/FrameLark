const status = document.querySelector('#copy-status');
document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const source = document.getElementById(button.dataset.copy);
    const content = source.value ?? source.textContent;
    try {
      await navigator.clipboard.writeText(content);
      status.textContent = button.dataset.copy === 'install-prompt'
        ? '已复制。粘贴到本地 Codex 对话，发送后开始安装。'
        : '已复制。粘贴到运行本地 Codex 的电脑终端。';
    } catch {
      // Clipboard can be unavailable on an insecure preview or after a browser denial.
      const selection = window.getSelection();
      const range = document.createRange();
      if (source.tagName === 'TEXTAREA') { source.focus(); source.select(); }
      else { range.selectNodeContents(source); selection.removeAllRanges(); selection.addRange(range); }
      status.textContent = '已选中内容，请手动复制。';
    }
  });
});
