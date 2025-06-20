document.addEventListener("DOMContentLoaded", () => {
    const boxes = document.querySelectorAll(".box");
    const darkToggle = document.querySelector(".dark-toggle");
    const rainbow = document.querySelectorAll(".rainbow");
    const btns = document.querySelectorAll(".btn");
    const indicator = document.querySelector(".indicator");
    let vid_number = 1;
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
        setTimeout(() => {box.children[0].classList.add("idle");}, delay+=400);
        box.children[0].addEventListener("click", () => {
            boxes.forEach((boxi) => {
                if(boxi !== box) boxi.classList.remove("active");
            });
            box.classList.toggle("active");
        });
    });

    btns.forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.classList.contains("rgt")) {
                console.log("right");
                indicator.classList.remove(`ind-${vid_number++}`);
                if (vid_number > 3) vid_number = 1;
                indicator.classList.add(`ind-${vid_number}`);
            } else if (btn.classList.contains("lft")) {
                console.log("left");
                indicator.classList.remove(`ind-${vid_number--}`);
                if (vid_number < 1) vid_number = 3;
                indicator.classList.add(`ind-${vid_number}`);
            }
        });
    });

    document.addEventListener("keydown", (e) => {
        if (e.repeat) return;
        if (e.key === "ArrowRight") {
            console.log("right");
            indicator.classList.remove(`ind-${vid_number++}`);
            if (vid_number > 3) vid_number = 1;
            indicator.classList.add(`ind-${vid_number}`);
        } else if (e.key === "ArrowLeft") {
            console.log("left");
            indicator.classList.remove(`ind-${vid_number--}`);
            if (vid_number < 1) vid_number = 3;
            indicator.classList.add(`ind-${vid_number}`);
        }
    });

    iteraterainbow();
});