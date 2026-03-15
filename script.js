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
