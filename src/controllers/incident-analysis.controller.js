import {analyzeIncident} from '../services/incident-analysis.service.js';
import mongoose from 'mongoose';import{AppError}from'../errors/app-errors.js';
export async function incidentAnalysis(req,res,next){
 if(Object.keys(req.query).length)return next(new AppError('Analysis has a fixed one-hour pre-incident window; no query parameters accepted',400));
 try{res.set('Cache-Control','no-store');res.json(await analyzeIncident(mongoose.connection.db,req.params.alertId));}catch(error){if(error.statusCode===429)res.set('Retry-After','1');next(error);}
}
