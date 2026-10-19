import {atomicJson} from './core/files.mjs'
export const CASE_IDS=['A01','A02','A03','A04','A05','A06','A07','A08','A09','A10','P01','P02','P03','P04','P05','P06','P07','P08','P09','T01','T02','T03','T04','T05','T06','T07','U01','U02','U03','R01','R02']
export function acceptanceMatrix({target,host,assets={},observations={}}) {
 return {schemaVersion:1,target,host,assets,generatedAt:new Date().toISOString(),cases:CASE_IDS.map(id=>({id,status:'unverified',reason:'尚未完成该平台的真实验收',...observations[id]})),scope:'Native acceptance only; unit tests are listed separately and cannot promote these cases.'}
}
export async function writeAcceptance(file,input){const report=acceptanceMatrix(input);await atomicJson(file,report);return report}
