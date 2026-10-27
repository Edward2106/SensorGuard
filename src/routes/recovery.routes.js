import {Router}from'express';import mongoose from'mongoose';import{createRecoveryService}from'../services/recovery.service.js';
const router=Router();const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);const service=()=>createRecoveryService(mongoose.connection.db);
router.post('/propose',wrap(async(req,res)=>res.status(201).json({data:await service().propose(req.body?.incidentId,req.auth)})));
router.get('/:id',wrap(async(req,res)=>res.json({data:await service().get(req.params.id)})));
router.patch('/:id/approve',wrap(async(req,res)=>res.json({data:await service().approve(req.params.id,req.auth,req.body?.confirmSimulation)})));
router.post('/:id/verify',wrap(async(req,res)=>res.json({data:await service().verify(req.params.id,req.auth)})));
export default router;
