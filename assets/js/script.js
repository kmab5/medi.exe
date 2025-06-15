document.addEventListener("DOMContentLoaded", () => {
    const boxes = document.querySelectorAll(".box");
    const darkToggle = document.querySelector(".dark-toggle");
    const rainbow = document.querySelectorAll(".rainbow");
    let rainbowCtr = 0;
    let speed = 500;
    let delay = -200;
    
    function iteraterainbow(){
        rainbowCtr++;
        if(rainbowCtr > 6) rainbowCtr = 0;
        for (let i = 0; i < rainbow.length; i++) {
            const el = rainbow[i];
            el.classList.remove("rainbow-1", "rainbow-2", "rainbow-3", "rainbow-4", "rainbow-5", "rainbow-6", "rainbow-7");
            el.classList.add(`rainbow-${((i + rainbowCtr) % 7) + 1}`);
        }
        setTimeout(iteraterainbow, speed);
    }

    function toggleMode(){
        document.body.classList.toggle("light");
        document.body.classList.toggle("dark");
        darkToggle.classList.toggle("active-icon");
    }

    darkToggle.addEventListener("click", toggleMode);

    boxes.forEach((box) => {
        setTimeout(() => {box.children[0].classList.add("idle");}, delay+=200);
        box.addEventListener("click", () => {
            boxes.forEach((boxi) => {
                if(boxi !== box) boxi.classList.remove("active");
            });
            box.classList.toggle("active");
        });
    });

    iteraterainbow();
});