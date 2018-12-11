const cluster=require('cluster')
const EventEmitter = require('events');
const report_signal = '_app_report_signal';
const sync_signal = '_app_sync_signal';
const stopPropagation = Symbol('stopPropagation');
//const setEvent = Symbol('setEvent');
const setEvent = 'setEvent';

/**
 * EventEmitter 代理器实现类需继承该类
 */
exports.events = class Events extends EventEmitter{
    constructor(){
        super();
        if(cluster.isMaster){
            cluster.on('message',(worker,data)=>{
                this.onMessage(data,worker.id)
            })
        }else{
            process.on('message',data=>{
                this.onMessage(data,cluster.isMaster)
            })
        }
        
    }
    /**
     * process.on('message',data=>{
     *  this.onMessage(data);
     * })
     * @param {object} data { signal, params }
     * @param {null || string || integer} workerId 接收的worker消息的所属ID
     */
    onMessage(data,workerId) {
        let { signal, params }=data;
        if(!signal||!params){
            this.emit('message',stopPropagation,data,workerId)
            return;
        }
        if (signal === report_signal) {
            if (params.event){
                this.emit(params.event,stopPropagation,...params.data);
                this.emitEvents(params.event,params.data,null,workerId)
                return;
            }
            this[params.key] = params.value;  //无法触发Proxy
        } else if (signal === sync_signal) {
            if (params.event) {
                this.emit(params.event,stopPropagation, ...params.data);
                return;
            }
            this[params.key] = params.value; //无法触发Proxy
        }else{
            this.emit('message',stopPropagation,data,workerId)
        }
    }
    /**
     * this.on('***',(...args)=>{
     *  this.emitEvents('***',args)
     * })
     * @param {string} event 
     * @param {object} data 触发Events时传输的数据
     * @param {null || object} worker 需要指定触发events的worker
     * @param {null || string || integer} workerId 需要指定触发events的worker的ID
     */
    emitEvents(event, data, worker, workerId){
        sync({ event, data }, worker, workerId)
        report({event,data})
    }
    emit(event,type,...args){
        if(type!==stopPropagation){
            args.unshift(type);
            this.emitEvents(event,args);
        }
        if(event===setEvent){
            this[args[0]]=args[1];
            return;
        }
        super.emit(event,...args)
    }
} 

/**
 * 属性代理器 （代理的属性仅包含非 Symbol的基础类型属性和 Array , Object 引用类型）
 * @param  {class}  Application 需要代理的类
 * @param  {object} options     代理器配置 {excludePrefix : '排除代理的属性前缀'}
 * @param  {mixed}  ...args     Application实例参数（可在constructor中接收的参数）
 */
exports.proxy = (Application,options={},...args) => {
    options=Object.assign({
        excludePrefix:'_'
    },options)
    return new Proxy(new Application(args), {
        set(target, key, value, receiver) {
            if (!Object.is(Reflect.get(target, key), value)) {
                sync({key, value});
                if (key.indexOf(options.excludePrefix) !== 0 && key instanceof Symbol===false) {
                    report({ key, value });
                }
            }
            return Reflect.set(target, key, value, receiver)
        },
        deleteProperty(target, key) {
            if (Reflect.get(target, key) !== undefined) {
                sync({ key, value:undefined});
                if (target[key] !== undefined) {
                    report({ key, value: undefined });
                }
            }
            return Reflect.deleteProperty(target, key);
        }

    })
    
    
}

/**
 * 上报信息
 * @param {object} params {key,value} or {event,data}
 */ 
function report(params) {
    if (cluster.isMaster) return;
    process.send({
        signal: report_signal,
        params
    })
}
/**
 * 同步信息
 * @param {object} params {key,value} or {event,data}
 * @param {object} worker 须同步的worker
 * @param {string || integer} excludeId 排除的workerId 
 */
function sync(params, worker,excludeId) {
    if (cluster.isWorker) return;
    if (worker) {
        worker.send({
            signal: sync_signal,
            params
        })
        return;
    }
    let workers = cluster.workers;
    for (let i in workers) {
        if (excludeId==i)continue;
        workers[i].send({
            signal: sync_signal,
            params
        })
    }
}