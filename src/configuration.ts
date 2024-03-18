
export default () => chooseConf();

interface TextbaseNestjsConfiguration {
    kafkaServers: string;
}

const prodConf: TextbaseNestjsConfiguration = {
    kafkaServers: process.env.KAFKA_SERVERS || "kafka:9052",
}

const yogaConf: TextbaseNestjsConfiguration = {
    kafkaServers: 'localhost:30115'
}

function chooseConf() {
    var os = require('os');
    const hostname: string = os.hostname();
    if ('yoga' == hostname.toLowerCase())
        return yogaConf;
    return prodConf;
}
