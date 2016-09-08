const SHT1x = require('./sht1x');
const sht1x = new SHT1x();

const DATA_PIN = 13;
const SCK_PIN = 11;

sht1x.open(SCK_PIN, DATA_PIN, () => {
    setInterval(() => {
        sht1x.measure((value) => {
            console.log(value);
        });
    }, 1000);
});
