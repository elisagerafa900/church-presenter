// Built-in looks for the projector / stream output.
export const BUILTIN_THEMES = [
  {
    id: 'midnight', name: 'Midnight',
    background: 'radial-gradient(ellipse at 30% 20%, #23305a 0%, #0b1022 55%, #05070f 100%)',
    textColor: '#ffffff', refColor: '#9fb4ff', font: 'sans',
  },
  {
    id: 'royal', name: 'Royal',
    background: 'radial-gradient(ellipse at 70% 10%, #5b2a86 0%, #2a1145 50%, #12071f 100%)',
    textColor: '#ffffff', refColor: '#f2c94c', font: 'serif',
  },
  {
    id: 'ember', name: 'Ember',
    background: 'radial-gradient(ellipse at 50% 120%, #b34712 0%, #4a1a08 40%, #120604 80%)',
    textColor: '#fff7ef', refColor: '#ffb27a', font: 'sans',
  },
  {
    id: 'forest', name: 'Forest',
    background: 'linear-gradient(160deg, #0f3b2e 0%, #0a2a21 50%, #04120e 100%)',
    textColor: '#f3fff9', refColor: '#7ee2b8', font: 'serif',
  },
  {
    id: 'black', name: 'Plain black',
    background: '#000000', textColor: '#ffffff', refColor: '#bbbbbb', font: 'sans',
  },
  {
    id: 'light', name: 'Light',
    background: 'linear-gradient(180deg, #fbf8f2 0%, #efe9dd 100%)',
    textColor: '#1d1b16', refColor: '#8a5a12', font: 'serif', shadow: false,
  },
];

export const FONTS = {
  sans: '"Segoe UI", "Helvetica Neue", Ubuntu, "Noto Sans", "DejaVu Sans", Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", "Noto Serif", "DejaVu Serif", serif',
};

/** Resize a picked image to max 1920 wide JPEG so it stays light. */
export function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1920 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
