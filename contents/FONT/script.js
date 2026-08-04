
const fontLinks = {
    "TenoText 3x6": "https://drive.google.com/file/d/1QerZ_rMFfWiN3U_g5FO63DoYzknbywKG/view?usp=drive_link",
    "TenoText 8x8": "https://drive.google.com/file/d/1TO2TQD6ArD0f_egjggsQ7QtCT_Ar-Ejw/view?usp=drive_link",
    "TenoText 8x10": "https://drive.google.com/file/d/1V5pzXQTsT-GlhXTkyZaxuvI3dSJ8iYbG/view?usp=drive_link",
    "TenoText 8x11(+Extended ASCII)": "https://drive.google.com/file/d/1G4F4z_FnSS57IZGjI8tT9SyzKhF6QAsa/view?usp=drive_link",
    "TenoText 7x13": "https://drive.google.com/file/d/1e2r7MQY0dx0raRujRLSlEe5t56a96aXh/view?usp=drive_link",
    "TenoText 11x31": "https://drive.google.com/file/d/1venB4GmraXTRS9n8n2huWCjlgzTya6Ea/view?usp=drive_link",
    "TenoGlyph 4x4": "https://drive.google.com/file/d/17GgSBsyuzpW1lCwy3xNTqT9Uz7eJrIuY/view?usp=drive_link",
    "TenoGlyph Magic": "https://drive.google.com/file/d/1FFgSVtty5hB7iOVTdVrrQBLCYMAK0Hkm/view?usp=drive_link"
};

document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('font-selector');
    const previewDisplay = document.getElementById('font-preview-display');
    const inputField = document.getElementById('preview-input');
    const downloadBtn = document.getElementById('download-button');

    selector.addEventListener('change', () => {
        const selectedFont = selector.value;
        previewDisplay.style.fontFamily = `'${selectedFont}'`;
    });

    inputField.addEventListener('input', () => {
        previewDisplay.textContent = inputField.value || "The quick brown fox jumps over the lazy dog.";
    });

    downloadBtn.addEventListener('click', () => {
        const selectedFont = selector.value;
        const link = fontLinks[selectedFont];
        if (link) {
            window.open(link, '_blank');
        } else {
            alert("リンクが設定されていないのです");
        }
    });
});