// 默认用户名和密码
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin';

// 验证新密码是否为弱密码
function isWeakPassword(password) {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return !regex.test(password);
}

// 检查是否是第一次登录
async function isFirstLogin(env) {
    const firstLogin = await env.DOMAIN_KV.get('first_login');
    return firstLogin === null || firstLogin === 'true';
}

// 设置为非第一次登录
async function setNotFirstLogin(env) {
    await env.DOMAIN_KV.put('first_login', 'false');
}

// 验证基本身份验证
async function authenticate(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader ||!authHeader.startsWith('Basic ')) {
        return false;
    }
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = atob(base64Credentials);
    const [username, password] = credentials.split(':');

    let storedUsername = DEFAULT_USERNAME;
    let storedPassword = DEFAULT_PASSWORD;

    const storedCredentials = await env.DOMAIN_KV.get('credentials');
    if (storedCredentials) {
        const { newUsername, newPassword } = JSON.parse(storedCredentials);
        storedUsername = newUsername;
        storedPassword = newPassword;
    }

    return username === storedUsername && password === storedPassword;
}

// 生成基本身份验证挑战
function generateAuthChallenge() {
    return new Response('未授权，请输入正确的用户名和密码。', {
        status: 401,
        headers: {
            'WWW-Authenticate': 'Basic realm="访问管理页面，请输入用户名和密码"',
        },
    });
}

// 处理密码更改请求
async function handlePasswordChange(formData, env) {
    const newUsername = formData.get('newUsername');
    const newPassword = formData.get('newPassword');

    if (newUsername === DEFAULT_USERNAME || newPassword === DEFAULT_PASSWORD) {
        return new Response('新的用户名和密码不能使用默认值。', { status: 400 });
    }

    if (isWeakPassword(newPassword)) {
        return new Response('新密码长度至少为8位，且必须包含至少一个大写字母、一个小写字母、一个数字和一个特殊字符。', { status: 400 });
    }

    await env.DOMAIN_KV.put('credentials', JSON.stringify({ newUsername, newPassword }));
    await setNotFirstLogin(env);
    return new Response('密码修改成功。你现在可以使用新的凭证登录。', { status: 200 });
}

// WHOIS 查询，支持不同顶级域名
async function whoisQuery(domain) {
    let apiKey = await env.DOMAIN_KV.get('whoisxmlapi_key');
    if (!apiKey) {
        apiKey = 'at_IMJi3ttjwDKlMmnSKB2qfIZlZf3at'; // 默认 API Key
    }
    if (domain.endsWith('.pp.ua')) {
        const apiUrl = `https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey=${apiKey}&domainName=${domain}&outputFormat=JSON`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                // 如果返回 404 状态码，说明域名未注册
                if (response.status === 404) {
                    return {
                        registrar: '未注册',
                        expiryDate: '无'
                    };
                }
                throw new Error('WHOIS 查询失败');
            }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");

            const registryData = xmlDoc.getElementsByTagName('registryData')[0];
            const registrar = registryData.getElementsByTagName('rawText')[0].textContent.match(/Sponsoring Registrar:([^\n]+)/)[1].trim();
            const expiryDate = registryData.getElementsByTagName('expiresDate')[0].textContent;

            return {
                registrar,
                expiryDate
            };
        } catch (error) {
            console.error('WHOIS 查询出错:', error);
            return null;
        }
    } else {
        const tld = domain.split('.').pop();
        let apiUrl;
        switch (tld) {
            case 'com':
                apiUrl = `https://rdap.verisign.com/com/v1/domain/${domain}`;
                break;
            case 'ua':
                apiUrl = `https://rdap.ua/domain/${domain}`;
                break;
            // 可以根据需要添加更多的顶级域名支持
            default:
                return null;
        }
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                // 如果返回 404 状态码，说明域名未注册
                if (response.status === 404) {
                    return {
                        registrar: '未注册',
                        expiryDate: '无'
                    };
                }
                throw new Error('WHOIS 查询失败');
            }
            const data = await response.json();
            let registrar;
            let expiryDate;
            registrar = data.entities.find(entity => entity.roles.includes('registrar'))?.vcardArray[1].find(item => item[0] === 'fn')[3];
            expiryDate = data.events.find(event => event.eventAction === 'expiration')?.eventDate;
            return {
                registrar,
                expiryDate
            };
        } catch (error) {
            console.error('WHOIS 查询出错:', error);
            return null;
        }
    }
}

// 每小时重新查询所有域名
async function hourlyWhoisQuery(env) {
    const keys = await env.DOMAIN_KV.list();
    for (const key of keys.keys) {
        const domain = key.name;
        const whoisData = await whoisQuery(domain);
        if (whoisData) {
            const { registrar, expiryDate } = whoisData;
            await env.DOMAIN_KV.put(domain, JSON.stringify({ registrar, expiryDate }));
        }
    }
}

// 获取所有域名信息
async function getAllDomains(env) {
    const keys = await env.DOMAIN_KV.list();
    const domains = [];
    for (const key of keys.keys) {
        const domain = key.name;
        // 过滤掉非域名的键
        if (domain === 'credentials' || domain === 'first_login' || domain === 'whoisxmlapi_key' || domain === 'wallpaper_url') {
            continue;
        }
        const data = await env.DOMAIN_KV.get(domain);
        if (data) {
            const { registrar, expiryDate } = JSON.parse(data);
            domains.push({ domain, registrar, expiryDate });
        }
    }
    return domains;
}

// 处理前端页面请求
async function handleFrontend(request, env) {
    if (!(await authenticate(request, env))) {
        return generateAuthChallenge();
    }

    let wallpaperUrl = await env.DOMAIN_KV.get('wallpaper_url');
    if (!wallpaperUrl) {
        wallpaperUrl = 'https://c-ssl.duitang.com/uploads/blog/202307/25/GgSgJDNptdPydl6.jpg';
    }

    if (await isFirstLogin(env)) {
        if (request.method === 'POST') {
            return await handlePasswordChange(await request.formData(), env);
        }

        const html = `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>修改密码</title>
            <style>
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-image: url(${wallpaperUrl});
                    background-size: cover;
                    background-position: center;
                }
                form {
                    background-color: white;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                }
                input[type="text"],
                input[type="password"] {
                    width: 100%;
                    padding: 10px;
                    margin-bottom: 15px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                }
                input[type="submit"] {
                    width: 100%;
                    padding: 10px;
                    background-color: #007BFF;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                input[type="submit"]:hover {
                    background-color: #0056b3;
                }
            </style>
        </head>
        <body>
            <form method="post">
                <h1 style="text-align: center;">首次登录 - 修改密码</h1>
                <label for="newUsername">新用户名:</label>
                <input type="text" id="newUsername" name="newUsername" required><br>
                <label for="newPassword">新密码:</label>
                <input type="password" id="newPassword" name="newPassword" required><br>
                <input type="submit" value="修改密码">
            </form>
        </body>
        </html>
        `;

        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
            },
        });
    }

    if (request.method === 'POST') {
        const formData = await request.formData();
        const action = formData.get('action');

        if (action === 'add') {
            const domain = formData.get('domain');
            if (domain) {
                const whoisData = await whoisQuery(domain);
                if (whoisData) {
                    const { registrar, expiryDate } = whoisData;
                    await env.DOMAIN_KV.put(domain, JSON.stringify({ registrar, expiryDate }));
                } else {
                    return new Response('WHOIS 查询失败，请稍后重试。', { status: 400 });
                }
            } else {
                return new Response('请输入有效的域名。', { status: 400 });
            }
        } else if (action === 'delete') {
            const domain = formData.get('deleteDomain');
            if (domain) {
                await env.DOMAIN_KV.delete(domain);
            } else {
                return new Response('要删除的域名无效，请检查输入。', { status: 400 });
            }
        } else if (action === 'changePassword') {
            return await handlePasswordChange(await request.formData(), env);
        } else if (action === 'setApiKey') {
            const newApiKey = formData.get('newApiKey');
            if (newApiKey) {
                await env.DOMAIN_KV.put('whoisxmlapi_key', newApiKey);
                return new Response('API Key 设置成功。', { status: 200 });
            } else {
                return new Response('请输入有效的 API Key。', { status: 400 });
            }
        } else if (action === 'setWallpaper') {
            const newWallpaperUrl = formData.get('newWallpaperUrl');
            if (newWallpaperUrl) {
                await env.DOMAIN_KV.put('wallpaper_url', newWallpaperUrl);
                return new Response('壁纸设置成功。', { status: 200 });
            } else {
                return new Response('请输入有效的壁纸 URL。', { status: 400 });
            }
        }
    }

    const domains = await getAllDomains(env);
    const domainList = domains.map(domain => `
        <tr>
            <td>${domain.domain}</td>
            <td>${domain.registrar}</td>
            <td>${domain.expiryDate}</td>
        </tr>
    `).join('');

    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>域名到期监控</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background-image: url(${wallpaperUrl});
                background-size: cover;
                background-position: center;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
            }
           .container {
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                gap: 20px;
                width: 100%;
                max-width: 1200px;
                margin-bottom: 20px;
            }
            form {
                background-color: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                width: calc(50% - 10px);
                min-width: 300px;
            }
            h1 {
                text-align: center;
                margin-bottom: 20px;
            }
            label {
                display: block;
                margin-bottom: 5px;
            }
            input[type="text"],
            input[type="password"] {
                width: 100%;
                padding: 12px;
                margin-bottom: 15px;
                border: 1px solid #ccc;
                border-radius: 4px;
                box-sizing: border-box;
            }
            input[type="submit"],
            button {
                padding: 10px 15px;
                background-color: #007BFF;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
            input[type="submit"]:hover,
            button:hover {
                background-color: #0056b3;
            }
            table {
                width: 100%;
                max-width: 1200px;
                border-collapse: collapse;
            }
            th, td {
                border: 1px solid #ddd;
                padding: 12px;
                text-align: left;
            }
            th {
                background-color: #f2f2f2;
            }
           .top-right-button {
                position: absolute;
                top: 20px;
                right: 20px;
                padding: 10px 20px;
                background-color: #007BFF;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
           .top-right-button:hover {
                background-color: #0056b3;
            }
           .settings-menu {
                display: none;
                position: absolute;
                top: 60px;
                right: 20px;
                background-color: white;
                padding: 10px;
                border-radius: 4px;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
            }
           .settings-menu button {
                width: 100%;
                padding: 10px;
                margin-bottom: 5px;
                background-color: #007BFF;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
           .settings-menu button:hover {
                background-color: #0056b3;
            }
           .form-buttons {
                display: flex;
                justify-content: space-between;
                margin-top: 15px;
            }
        </style>
    </head>
    <body>
        <button class="top-right-button" onclick="toggleSettingsMenu()">设置</button>
        <div class="settings-menu" id="settingsMenu">
            <button onclick="document.getElementById('changePasswordForm').style.display='block'; document.getElementById('settingsMenu').style.display='none'">修改密码</button>
            <button onclick="document.getElementById('setApiKeyForm').style.display='block'; document.getElementById('settingsMenu').style.display='none'">设置 WHOISXMLAPI API Key</button>
            <button onclick="document.getElementById('setWallpaperForm').style.display='block'; document.getElementById('settingsMenu').style.display='none'">设置壁纸</button>
        </div>
        <div class="container">
            <form method="post">
                <h1>添加域名</h1>
                <input type="hidden" name="action" value="add">
                <label for="domain">域名:</label>
                <input type="text" id="domain" name="domain" required>
                <input type="submit" value="添加域名">
            </form>
            <form method="post">
                <h1>删除域名</h1>
                <input type="hidden" name="action" value="delete">
                <label for="deleteDomain">要删除的域名:</label>
                <input type="text" id="deleteDomain" name="deleteDomain" required>
                <input type="submit" value="删除域名">
            </form>
        </div>
        <table>
            <thead>
                <tr>
                    <th>域名</th>
                    <th>注册商</th>
                    <th>到期日期</th>
                </tr>
            </thead>
            <tbody>
                ${domainList}
            </tbody>
        </table>
        <form id="changePasswordForm" method="post" style="display:none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); z-index: 100;">
            <h1 style="text-align: center;">修改用户名密码</h1>
            <input type="hidden" name="action" value="changePassword">
            <label for="newUsername">新用户名:</label>
            <input type="text" id="newUsername" name="newUsername" required><br>
            <label for="newPassword">新密码:</label>
            <input type="password" id="newPassword" name="newPassword" required><br>
            <div class="form-buttons">
                <input type="submit" value="修改密码">
                <button type="button" onclick="document.getElementById('changePasswordForm').style.display='none'">取消</button>
            </div>
        </form>
        <form id="setApiKeyForm" method="post" style="display:none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); z-index: 100;">
            <h1 style="text-align: center;">设置 WHOISXMLAPI API Key</h1>
            <input type="hidden" name="action" value="setApiKey">
            <label for="newApiKey">新 API Key:</label>
            <input type="text" id="newApiKey" name="newApiKey" required><br>
            <div class="form-buttons">
                <input type="submit" value="设置 API Key">
                <button type="button" onclick="document.getElementById('setApiKeyForm').style.display='none'">取消</button>
            </div>
        </form>
        <form id="setWallpaperForm" method="post" style="display:none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); z-index: 100;">
            <h1 style="text-align: center;">设置壁纸</h1>
            <input type="hidden" name="action" value="setWallpaper">
            <label for="newWallpaperUrl">新壁纸 URL:</label>
            <input type="text" id="newWallpaperUrl" name="newWallpaperUrl" required><br>
            <div class="form-buttons">
                <input type="submit" value="设置壁纸">
                <button type="button" onclick="document.getElementById('setWallpaperForm').style.display='none'">取消</button>
            </div>
        </form>
        <script>
            function toggleSettingsMenu() {
                const settingsMenu = document.getElementById('settingsMenu');
                if (settingsMenu.style.display === 'block') {
                    settingsMenu.style.display = 'none';
                } else {
                    settingsMenu.style.display = 'block';
                }
            }
        </script>
    </body>
    </html>
    `;

    return new Response(html, {
        headers: {
            'Content-Type': 'text/html',
        },
    });
}

export default {
    async fetch(request, env) {
        return handleFrontend(request, env);
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil(hourlyWhoisQuery(env));
    }
};    
