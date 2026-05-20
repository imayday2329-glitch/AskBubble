const PLATFORMS = {
  deepseek:  { label: 'DeepSeek',          apiFormat: 'openai',     baseUrl: 'https://api.deepseek.com/v1',                models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'] },
  openai:    { label: 'OpenAI',             apiFormat: 'openai',     baseUrl: 'https://api.openai.com/v1',                  models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  anthropic: { label: 'Anthropic (Claude)', apiFormat: 'anthropic',  baseUrl: 'https://api.anthropic.com',                  models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  moonshot:  { label: 'Moonshot (Kimi)',    apiFormat: 'openai',     baseUrl: 'https://api.moonshot.cn/v1',                 models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  zhipu:     { label: '智谱 GLM',           apiFormat: 'openai',     baseUrl: 'https://open.bigmodel.cn/api/paas/v4',       models: ['glm-4', 'glm-4-flash', 'glm-4-plus', 'glm-4-long'] },
  doubao:    { label: '豆包 (火山引擎)',     apiFormat: 'openai',     baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',   models: [] },
  custom:    { label: '自定义',              apiFormat: 'openai',     baseUrl: '',                                           models: [] },
};

const platformEl  = document.getElementById('platformSelect');
const apiKeyEl    = document.getElementById('apiKey');
const modelEl     = document.getElementById('model');
const modelList   = document.getElementById('model-list');
const baseUrlEl   = document.getElementById('baseUrl');
const statusEl    = document.getElementById('status');

platformEl.addEventListener('change', () => {
  const key = platformEl.value;
  if (!key) {
    [apiKeyEl, modelEl, baseUrlEl].forEach(el => {
      el.disabled = true;
      el.value = '';
      el.placeholder = '选择平台后填写';
    });
    modelList.innerHTML = '';
    return;
  }

  const p = PLATFORMS[key];
  apiKeyEl.disabled = false;
  apiKeyEl.placeholder = 'sk-...';
  modelEl.disabled = false;
  baseUrlEl.disabled = key !== 'custom'; // 自定义时可编辑，其余只读

  baseUrlEl.value = p.baseUrl;
  baseUrlEl.placeholder = p.baseUrl || '请填写接口地址';

  modelList.innerHTML = '';
  p.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    modelList.appendChild(opt);
  });

  if (p.models.length > 0) {
    modelEl.value = p.models[0];
  } else {
    modelEl.value = '';
    modelEl.placeholder = '请手动填写模型名称';
  }
});

// 加载已保存设置
chrome.storage.sync.get(['platform', 'apiKey', 'model', 'baseUrl'], (data) => {
  if (data.platform) {
    platformEl.value = data.platform;
    platformEl.dispatchEvent(new Event('change')); // 填好 baseUrl 和模型列表
  }
  if (data.apiKey) apiKeyEl.value = data.apiKey;
  // 只有当保存的模型属于当前平台列表时才恢复，否则用平台默认值
  if (data.model && data.platform) {
    const p = PLATFORMS[data.platform];
    if (!p || p.models.length === 0 || p.models.includes(data.model)) {
      modelEl.value = data.model;
    }
  }
  if (data.baseUrl) baseUrlEl.value = data.baseUrl;
});

document.getElementById('save').addEventListener('click', () => {
  const platform = platformEl.value;
  const apiKey   = apiKeyEl.value.trim();
  const model    = modelEl.value.trim();
  const baseUrl  = baseUrlEl.value.trim();

  if (!platform) { showStatus('请先选择平台', 'error'); return; }
  if (!apiKey)   { showStatus('请填写 API Key', 'error'); return; }
  if (!model)    { showStatus('请填写模型名称', 'error'); return; }
  if (!baseUrl)  { showStatus('请填写 API Base URL', 'error'); return; }

  const apiFormat = PLATFORMS[platform]?.apiFormat || 'openai';
  chrome.storage.sync.set({ platform, apiKey, model, baseUrl, provider: apiFormat }, () => {
    showStatus('✓ 已保存', 'ok');
  });
});

function showStatus(msg, type) {
  statusEl.style.color = type === 'ok' ? '#6adc6a' : '#ff6b6b';
  statusEl.textContent = msg;
  if (type === 'ok') setTimeout(() => { statusEl.textContent = ''; }, 2000);
}
