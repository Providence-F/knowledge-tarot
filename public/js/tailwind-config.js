// 知识塔罗 · Tailwind 共享 config（单一事实源）
// 与 css/style.css :root 的 token 保持同步：
//   --bg #ffffff / --ink #0a0a0a / --text #1a1a1a / --muted #555555
//   --border #e5e5e5 / --accent #f5f5f5
// 我是白：纯黑白灰，tarot.gold 仅保留语义（指向 ink），禁止真彩色。
window.tailwind = window.tailwind || {};
tailwind.config = {
  theme: {
    extend: {
      colors: {
        tarot: {
          bg: '#ffffff',
          card: '#ffffff',
          gold: '#000000',
          ivory: '#1a1a1a',
          muted: '#555555',
          border: '#e5e5e5',
          accent: '#f5f5f5'
        }
      },
      fontFamily: {
        serif: ['Georgia', 'Noto Serif SC', 'serif'],
        sans: ['Inter', 'Noto Sans SC', 'system-ui', 'sans-serif']
      }
    }
  }
};
