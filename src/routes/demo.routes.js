import{Router}from'express';import mongoose from'mongoose';import{startDemo,readDemo}from'../queues/demo.worker.js';import{BadRequestError}from'../errors/app-errors.js';
const r=Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
r.post('/',wrap(async(req,res)=>res.status(202).json({data:await startDemo(mongoose.connection.db,req.body?.scenario,req.auth)})));
r.get('/',wrap(async(req,res)=>{if(Object.keys(req.query).length)throw new BadRequestError('Recent demo history has a fixed limit of 20');res.json({data:await mongoose.connection.db.collection('demo_runs').find({},{maxTimeMS:1000,projection:{_id:1,scenario:1,state:1,sensorId:1,createdAt:1,finishedAt:1}}).sort({createdAt:-1}).limit(20).toArray()});}));
r.get('/:id',wrap(async(req,res)=>res.json({data:await readDemo(mongoose.connection.db,req.params.id)})));
export default r;
