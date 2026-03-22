// 滚动到对应章节时，在导航标题下显示横线（scroll-spy）
const navLinks = document.querySelectorAll('.nav-menu a[href^="#"]');
const sections = document.querySelectorAll('section[id]');
const scrollOffset = 120;

function updateActiveNav() {
    const viewportTop = window.pageYOffset + scrollOffset;
    let currentId = null;
    let currentTop = -Infinity;

    sections.forEach(section => {
        const sectionTop = section.getBoundingClientRect().top + window.pageYOffset;
        if (sectionTop <= viewportTop && sectionTop > currentTop) {
            currentTop = sectionTop;
            currentId = section.id;
        }
    });
    if (currentId == null && sections.length) {
        currentId = sections[0].id;
    }

    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        const id = href === '#' ? null : href.slice(1);
        link.classList.toggle('nav-active', id === currentId);
    });
}

window.addEventListener('scroll', updateActiveNav);
window.addEventListener('load', updateActiveNav);

// 平滑滚动
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// 导航栏滚动效果
let lastScroll = 0;
const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    
    if (currentScroll > 100) {
        navbar.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
    } else {
        navbar.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
    }
    
    lastScroll = currentScroll;
});

// 代码块复制功能（可选）
document.querySelectorAll('pre code').forEach(block => {
    const button = document.createElement('button');
    button.textContent = '复制';
    button.className = 'copy-button';
    button.style.cssText = `
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: var(--primary-color);
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 0.25rem;
        cursor: pointer;
        font-size: 0.875rem;
    `;
    
    const pre = block.parentElement;
    pre.style.position = 'relative';
    pre.appendChild(button);
    
    button.addEventListener('click', () => {
        navigator.clipboard.writeText(block.textContent).then(() => {
            button.textContent = '已复制!';
            setTimeout(() => {
                button.textContent = '复制';
            }, 2000);
        });
    });
});

// 滚动动画（可选）
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// 为卡片添加动画
document.querySelectorAll('.feature-card, .application-card, .status-item').forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(card);
});

// ==============================
// 右侧 AI 客服（调用后端 API）
// ==============================
document.addEventListener('DOMContentLoaded', () => {
    const widget = document.getElementById('chat-widget');
    const minimizeBtn = widget ? widget.querySelector('.chat-minimize') : null;
    const messagesEl = document.getElementById('chat-messages');
    const statusEl = document.getElementById('chat-status');
    const formEl = document.getElementById('chat-form');
    const inputEl = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');

    if (!widget || !messagesEl || !statusEl || !formEl || !inputEl || !sendBtn) return;

    // 静态托管（GitHub Pages 等）与客服 API 常在另一台机器：用「远程默认」或 meta / CHAT_API_BASE 指向 ngrok 等（根 URL，无末尾 /）
    const DEFAULT_REMOTE_CHAT_API_BASE =
        'https://sana-uncalmative-cristine.ngrok-free.dev';

    const safePageOrigin = () => {
        const o = location.origin;
        if (typeof o !== 'string' || !o || o === 'null') return '';
        return /^https?:\/\/[^/]+/i.test(o) ? o : '';
    };

    const metaChatBase = (() => {
        const el = document.querySelector('meta[name="msp-chat-api-base"]');
        if (!el) return '';
        const c = el.getAttribute('content');
        return typeof c === 'string' ? c.trim() : '';
    })();

    const host = (location.hostname || '').toLowerCase();
    const isGitHubPagesHost =
        host === 'github.io' || host.endsWith('.github.io');
    const isLocalDevHost =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '[::1]';

    const urlParams = new URLSearchParams(location.search);
    const fromQuery = (
        urlParams.get('chat_api_base') ||
        urlParams.get('msp_chat_api_base') ||
        ''
    ).trim();

    const fromWindow =
        typeof window.CHAT_API_BASE === 'string'
            ? window.CHAT_API_BASE.trim()
            : '';

    /** 人类可读：当前页如何选出客服 API 根地址（用于气泡内调试） */
    let apiResolveLabel = '';

    let apiBase = '';
    if (fromWindow) {
        apiBase = fromWindow;
        apiResolveLabel = 'window.CHAT_API_BASE';
    } else if (fromQuery) {
        apiBase = fromQuery;
        apiResolveLabel = 'URL 参数 chat_api_base（或 msp_chat_api_base）';
    } else if (!isLocalDevHost && metaChatBase) {
        // 自定义域名 GitHub Pages、任意 HTTPS 静态站：必须用 meta 指向跑 website_ai_service 的机器
        apiBase = metaChatBase;
        apiResolveLabel = 'meta[name=msp-chat-api-base]';
    } else if (isLocalDevHost && location.protocol !== 'file:') {
        apiBase = safePageOrigin();
        apiResolveLabel = '本机同源（与当前页同 origin）';
    } else if (isGitHubPagesHost || location.protocol === 'file:') {
        apiBase = DEFAULT_REMOTE_CHAT_API_BASE;
        apiResolveLabel = 'github.io / file 回退默认远程（与 script 内 DEFAULT_REMOTE 一致）';
    } else {
        apiBase = safePageOrigin();
        apiResolveLabel =
            '页面同源（非 github.io 且无 meta：静态站通常没有 /api/chat，请在 HTML 里配置 meta 或使用 ?chat_api_base=）';
    }

    const stripSlash = (s) => String(s == null ? '' : s).trim().replace(/\/+$/, '');
    let baseNoSlash = stripSlash(apiBase);
    // 部分 WebView / 异常 origin 会得到不可解析的 base，统一回退到默认远程，避免误判「无效地址」而不发请求
    if (!baseNoSlash || !/^https?:\/\//i.test(baseNoSlash)) {
        baseNoSlash = stripSlash(DEFAULT_REMOTE_CHAT_API_BASE);
        apiResolveLabel += ' → 原地址非法，已回退 DEFAULT_REMOTE';
    }
    const CHAT_API_URL = `${baseNoSlash}/api/chat`;

    const escapeText = (s) => String(s).replace(/\r/g, '').replace(/\n/g, '\n');

    const history = [];
    const setStatus = (text) => {
        statusEl.textContent = text || '';
    };

    const scrollToBottom = () => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    const addMessage = (role, content, opts) => {
        const wrap = document.createElement('div');
        wrap.className = `chat-message ${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        bubble.textContent = escapeText(content);

        wrap.appendChild(bubble);

        const extra =
            opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
        const debugLines = extra.debugLines;
        if (Array.isArray(debugLines) && debugLines.length) {
            const dbg = document.createElement('div');
            dbg.className = 'chat-bubble-debug';
            dbg.textContent = debugLines.join('\n');
            wrap.appendChild(dbg);
        }

        messagesEl.appendChild(wrap);
        scrollToBottom();
    };

    const buildChatDebugLines = (detail = {}) => {
        const lines = [
            '[调试] 客服 API',
            `POST ${CHAT_API_URL}`,
            `API 根: ${baseNoSlash}`,
            `页面: ${safePageOrigin() || location.href}`,
            `hostname: ${host || '(空)'}`,
            `配置来源: ${apiResolveLabel}`
        ];
        if (detail.httpStatus != null && detail.httpStatus !== '') {
            lines.push(`HTTP: ${detail.httpStatus}`);
        }
        if (detail.fetchError) {
            lines.push(`异常: ${detail.fetchError}`);
        }
        return lines;
    };

    // 初始欢迎语
    addMessage(
        'assistant',
        '您好！我是ai客服。你可以询问我任何问题，我能尽量回答。'
    );

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            const minimized = widget.classList.toggle('chat-minimized');
            minimizeBtn.textContent = minimized ? '+' : '−';
            minimizeBtn.setAttribute('aria-label', minimized ? '展开' : '缩小');
            minimizeBtn.setAttribute('aria-expanded', minimized ? 'false' : 'true');
        });
    }

    const sendChat = async (question) => {
        inputEl.disabled = true;
        sendBtn.disabled = true;
        setStatus('请等待回复...');

        try {
            addMessage('user', question);
            history.push({ role: 'user', content: question });

            const payload = {
                question,
                history: history.slice(-10)
            };

            const headers = {
                'Content-Type': 'application/json'
            };
            // ngrok 免费域名在浏览器里请求 API 时建议带上，避免拦截页导致非 JSON / 连接异常
            if (/ngrok-free\.dev|ngrok\.io/i.test(CHAT_API_URL)) {
                headers['ngrok-skip-browser-warning'] = 'true';
            }

            console.debug('[MSP 客服] 请求', CHAT_API_URL, {
                resolve: apiResolveLabel,
                host
            });

            const res = await fetch(CHAT_API_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const hint =
                    data.detail ||
                    data.error ||
                    (res.status === 503
                        ? '无法连接客服后端，请稍后尝试'
                        : '');
                const err = new Error(
                    hint ? `HTTP ${res.status}：${hint}` : `HTTP ${res.status}`
                );
                err.httpStatus = res.status;
                throw err;
            }

            const answer = data.answer ?? data.reply ?? '';

            addMessage('assistant', answer || '抱歉，我暂时无法回答。', {
                debugLines: buildChatDebugLines({ httpStatus: res.status })
            });
            history.push({ role: 'assistant', content: answer });
        } catch (e) {
            setStatus('');
            let msg = e && e.message ? e.message : '未知错误';
            let fetchTag = e && e.name ? e.name : '';
            const httpStatus = e && e.httpStatus != null ? e.httpStatus : null;
            if (msg === 'Failed to fetch' || (e && e.name === 'TypeError')) {
                msg =
                    '无法连接客服后端，请稍后尝试';
                fetchTag = fetchTag || 'TypeError/网络或 CORS';
            }
            console.debug('[MSP 客服] 失败', CHAT_API_URL, e);
            addMessage('assistant', '出错了：' + msg, {
                debugLines: buildChatDebugLines({
                    httpStatus,
                    fetchError: fetchTag ? `${fetchTag}: ${e && e.message ? e.message : msg}` : msg
                })
            });
        } finally {
            inputEl.disabled = false;
            sendBtn.disabled = false;
        }
    };

    formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = inputEl.value.trim();
        if (!q) return;
        inputEl.value = '';
        await sendChat(q);
    });
});
