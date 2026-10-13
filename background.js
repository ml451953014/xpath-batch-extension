chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({target:{tabId:tab.id}, files:['core.js','table-core.js','table-ui.js','content.js']});
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
    await chrome.action.setTitle({tabId:tab.id,title:'开启 XPath 批量文字提取'});
  } catch (error) {
    // Chrome system pages, Web Store and PDF viewer may reject injection.
    await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:'#a61b35'});
    await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    await chrome.action.setTitle({tabId:tab.id,title:'此页面不允许注入，请切换到普通网页后重试'});
    console.warn('XPath batch: injection unavailable', error.message);
  }
});
