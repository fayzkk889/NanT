const hosted = document.documentElement.dataset.runtime === 'hosted';
await import(hosted ? './cloud-app.js' : './app.js');
