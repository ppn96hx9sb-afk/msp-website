//ver 1

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

    const fromWindow =
        typeof window.CHAT_API_BASE === 'string'
            ? window.CHAT_API_BASE.trim()
            : '';
    // 本机调试走同源 API；meta 仅用于非本机（如 GitHub Pages），避免同一 index 在本地也被迫打到 ngrok
    let explicitBase = fromWindow;
    if (!explicitBase && !isLocalDevHost && metaChatBase) {
        explicitBase = metaChatBase;
    }

    let apiBase = explicitBase;
    if (!apiBase) {
        if (isLocalDevHost && location.protocol !== 'file:') {
            apiBase = safePageOrigin();
        } else if (isGitHubPagesHost || location.protocol === 'file:') {
            apiBase = DEFAULT_REMOTE_CHAT_API_BASE;
        } else {
            apiBase = safePageOrigin();
        }
    }

    const stripSlash = (s) => String(s == null ? '' : s).trim().replace(/\/+$/, '');
    let baseNoSlash = stripSlash(apiBase);
    // 部分 WebView / 异常 origin 会得到不可解析的 base，统一回退到默认远程，避免误判「无效地址」而不发请求
    if (!baseNoSlash || !/^https?:\/\//i.test(baseNoSlash)) {
        baseNoSlash = stripSlash(DEFAULT_REMOTE_CHAT_API_BASE);
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

    const addMessage = (role, content, sources) => {
        const wrap = document.createElement('div');
        wrap.className = `chat-message ${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        bubble.textContent = escapeText(content);

        wrap.appendChild(bubble);
        messagesEl.appendChild(wrap);
        scrollToBottom();


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
                // 整段对话发给后端；后端可按 MAX_CHAT_HISTORY_MESSAGES 截断以防超长
                history: history
            };

            const headers = {
                'Content-Type': 'application/json'
            };
            // ngrok 免费域名在浏览器里请求 API 时建议带上，避免拦截页导致非 JSON / 连接异常
            if (/ngrok-free\.dev|ngrok\.io/i.test(CHAT_API_URL)) {
                headers['ngrok-skip-browser-warning'] = 'true';
            }

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
                throw new Error(
                    hint ? `HTTP ${res.status}：${hint}` : `HTTP ${res.status}`
                );
            }

            const answer = data.answer ?? data.reply ?? '';
            const sources = data.sources ?? [];

            addMessage('assistant', answer || '抱歉，我暂时无法回答。', sources);
            history.push({ role: 'assistant', content: answer });
        } catch (e) {
            setStatus('');
            let msg = e && e.message ? e.message : '未知错误';
            if (msg === 'Failed to fetch' || (e && e.name === 'TypeError')) {
                msg =
                    '无法连接客服后端，请稍后尝试';
            }
            const errText = '出错了：' + msg;
            addMessage('assistant', errText);
            history.push({ role: 'assistant', content: errText });
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
