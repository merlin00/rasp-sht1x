var rpio = require('rpio');
var async = require('async');
var moment = require('moment');

var RESET_BYTE = 0x1E;
var TEMPERATURE_BYTE = 0x03;
var HUMIDITY_BYTE = 0x05;

var C1 = -4.0;
var C2 = +0.0405;
var C3 = -0.0000028;
var T1 = +0.01;
var T2 = +0.00008;

module.exports = function() {
    var _SCK;
    var _DATA;
    var _measurement = {};
    var _STATE_REG = 0;
    var _crc = 0;
    var _is_open = false;

    function SCK_HIGH() {
        rpio.write(_SCK, rpio.HIGH);
    }

    function SCK_LOW() {
        rpio.write(_SCK, rpio.LOW);
    }

    function DATA_HIGH() {
        rpio.mode(_DATA, rpio.INPUT);
    }

    function DATA_LOW() {
        rpio.mode(_DATA, rpio.OUTPUT);
    }

    function DATA_READ() {
        return rpio.read(_DATA);
    }

    function DELAY() {
        rpio.usleep(1);
    }

    // Transmission Start Command Sequence
    var TRANSMISSION = [SCK_HIGH, DELAY,
        DATA_LOW, DELAY,
        SCK_LOW, DELAY,
        SCK_HIGH, DELAY,
        DATA_HIGH, DELAY,
        SCK_LOW, DELAY
    ];

    // Reset command Sequence
    var RESET = [DATA_HIGH, DELAY];

    for (var i = 0; i < 9; i++) {
        RESET.push(SCK_HIGH, DELAY, SCK_LOW, DELAY);
    }

    // Reset SHT1x.
    function _reset_sht1x() {
        _send_signals(RESET);
        _send_signals(TRANSMISSION);
        //Soft reset, Waits 11ms until status registers have default values
        _send_byte(RESET_BYTE);
        rpio.msleep(11);
    }

    // Send command.
    function _send_signals(SIGNALS) {
        SIGNALS.forEach(function(fun) {
            fun();
        });
    }

    function _send_byte(BYTE) {
        var ack = false;

        for (var mask = 0x80; mask; mask >>= 1) {
            SCK_LOW();
            DELAY();

            if (BYTE & mask) {
                DATA_HIGH();
            } else {
                DATA_LOW();
            }

            DELAY();

            SCK_HIGH();
            DELAY();
        }

        SCK_LOW();
        DELAY();

        DATA_HIGH();
        DELAY();
        SCK_HIGH();
        DELAY();

        if (!DATA_READ()) {
            ack = true;
        }

        SCK_LOW();
        DELAY();

        return ack;
    }

    function _read_byte(ACK) {
        var value = 0;

        for (var mask = 0x80; mask; mask >>= 1) {
            SCK_HIGH();
            DELAY();

            if (DATA_READ() == 1) {
                value = value | mask;
            }

            SCK_LOW();
            DELAY();
        }

        if (ACK) {
            DATA_LOW();
            DELAY();
        }

        SCK_HIGH();
        DELAY();
        SCK_LOW();
        DELAY();

        if (ACK) {
            DATA_HIGH();
            DELAY();
        }

        return value;
    }

    function _mirror_byte(value) {
        var ret = 0,
            i;
        for (i = 0x80; i; i >>= 1) {
            if (value & 0x01) {
                ret |= i;
            }
            value >>= 1;
        }
        return ret;
    }

    function _calculate_crc(value_byte) {
        for (var i = 0; i < 8; i++) {
            if ((crc ^ value_byte) & 0x80) {
                crc <<= 1;
                crc ^= 0x31;
            } else {
                crc <<= 1;
            }
            value_byte <<= 1;
        }
        crc &= 0xFF;
        return crc;
    }

    function _measure(TYPE) {
        var delay_count = 62;
        var result = {
            succeed: false,
            timeout: false,
            value: 0
        };

        _send_signals(TRANSMISSION);
        crc = _mirror_byte(_STATE_REG & 0x0F);

        _send_byte(TYPE);
        _calculate_crc(TYPE);

        // Waits until DATA pin downs low signal.
        // If it's over 800ms, Timeout.
        while (DATA_READ()) {
            rpio.msleep(5);
            delay_count--;
            if (delay_count === 0) {
                result.timeout = true;
                return result;
            }
        }

        var data = [],
            checksum;
        data.push(_read_byte(true));
        data.push(_read_byte(true));
        checksum = _read_byte(false);

        _calculate_crc(data[0]);
        _calculate_crc(data[1]);

        if (_mirror_byte(checksum) == crc) {
            result.value = (data[0] << 8) + data[1];
            result.succeed = true;
        }

        return result;
    }

    this.open = function(SCK, DATA, callback) {
        if (_is_open) return;

        _SCK = SCK;
        _DATA = DATA;
        _STATE_REG = 0;
        _crc = 0;

        _measurement.measured_time = 0;
        _measurement.temperature = {};
        _measurement.temperature.succeed = false;
        _measurement.temperature.timeout = false;
        _measurement.temperature.value = 0;
        _measurement.humidity = {};
        _measurement.humidity.succeed = false;
        _measurement.humidity.timeout = false;
        _measurement.humidity.value = 0;

        rpio.msleep(20);
        rpio.open(_SCK, rpio.OUTPUT, rpio.LOW);
        rpio.open(_DATA, rpio.OUTPUT, rpio.LOW);

        _reset_sht1x();
        _is_opne = true;

        callback();
    };

    this.close = function() {
        if (!_is_open) {
            return;
        } else {
            rpio.close(_SCK);
            rpio.close(_DATA);
            _SCK = 0;
            _DATA = 0;
        }
    };

    this.reset = function() {
        _reset_sht1x();
    };

    this.getTemperature = function(callback) {
        var report = {};
        var t = measurement.temperature;
        report.measured_time = measurement.measured_time;
        report.temperature = t.value;

        return report;
    };

    this.getHumidity = function(callback) {
        var report = {};
        var h = measurement.humidity;
        report.measured_time = measurement.measured_time;
        report.humidity = h.value;

        return report;
    };

    this.measure = function(callback) {
        async.series([
            function() {
                var t = _measurement.temperature;
                var h = _measurement.humidity;
                var result = [];

                result.push(_measure(TEMPERATURE_BYTE));
                result.push(_measure(HUMIDITY_BYTE));

                var cur_time = moment();
                _measurement.measured_time = cur_time.format('YY-MM-DD HH:mm:ss:SSS');

                if (result[0].succeed) {
                    t.succeed = result[0].succeed;
                    t.value = result[0].value * 0.01 - 40;
                    t.timeout = result[0].timeout;
                }

                if (result[1].succeed) {
                    h.succeed = result[1].succeed;
                    h.timeout = result[1].timeout;

                    var rh = result[1].value;
                    var rh_lin = C3 * rh * rh + C2 * rh + C1;
                    var rh_true;

                    if (result[0].succeed) {
                        rh_true = (t.value - 25) * (T1 + T2 * rh) + rh_lin;
                        if (rh_true > 100) {
                            rh_true = 100;
                        }
                        if (rh_true < 0.1) {
                            rh_true = 0.1;
                        }
                        h.value = rh_true;
                    } else {
                        h.value = rh_lin;
                    }
                }
                callback(_measurement);
            }
        ]);
    };

    this.getSCK = function() {
        return _SCK;
    };

    this.getDATA = function() {
        return _DATA;
    };
};
