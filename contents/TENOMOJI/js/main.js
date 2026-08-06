(function () {
    const input = document.getElementById("inputText");
    const output = document.getElementById("outputText");
    const charCount = document.getElementById("charCount");
    const copyBtn = document.getElementById("copyBtn");
    const clearBtn = document.getElementById("clearBtn");
    const copyStatus = document.getElementById("copyStatus");

    function update() {
        const value = input.value;
        output.value = tenomojiConvert(value);
        charCount.textContent = String(value.length);
    }

    input.addEventListener("input", update);

    clearBtn.addEventListener("click", () => {
        input.value = "";
        update();
        input.focus();
    });

    copyBtn.addEventListener("click", async () => {
        if (!output.value) return;
        try {
            await navigator.clipboard.writeText(output.value);
            copyStatus.textContent = "COPIED!";
            copyStatus.className = "copy-status ok";
        } catch (e) {
            output.select();
            document.execCommand("copy");
            copyStatus.textContent = "COPIED!";
            copyStatus.className = "copy-status ok";
        }
        setTimeout(() => {
            copyStatus.textContent = "";
            copyStatus.className = "copy-status";
        }, 1500);
    });

    update();
})();
