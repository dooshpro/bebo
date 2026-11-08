document.getElementById('cycle-phase')
document.getElementById('cycle-phase').textContent = 'luteal phase'

function navTo(name) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active-screen');
    });
    document.getElementById(`screen-${name}`).classList.add('active-screen');
}
