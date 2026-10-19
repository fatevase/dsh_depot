import {generateSite as buildWebsite} from '../../web/build.mjs'
import {catalogOf} from './publish.mjs'
export async function generateSite({catalog,state,recipes=[],...options}){
 return buildWebsite({...options,catalog:catalog??catalogOf(state,recipes)})
}
