import { IBackgroundService, ProcessState } from './interfaces';
import { ObjectParser } from '../utils/ObjectParser';

export function getDefaultServiceData(): IBackgroundService {
  return ({
    name: 'invalid',
    state: ProcessState.STOPPED,
    pid: -1,
    startTime: 0
  });
}

export function overwriteServiceData(
  source: IBackgroundService,
  data: Partial<IBackgroundService>,
  onError?: (error: string) => void
): IBackgroundService {
  const parser = new ObjectParser({
    input: data,
    onError: onError && (error => onError(`Error while parsing Config: ${error.toString()}`)),
  });
  parser.prop('name',                v => source.name      = str(v));
  parser.prop('pid',                 v => source.pid       = num(v));
  parser.prop('startTime',           v => source.startTime = num(v));
  parser.prop('state',               v => source.state     = state(v));
  parser.prop('info',                v => source.info      = v);

  // Return
  return source;
}

/** Coerce anything to a string. */
function str(str: any): string {
  return (str || '') + '';
}

/** Give a -1 for broken num */
function num(num: number | undefined): number {
  return (num || -1);
}

function state(state: ProcessState | undefined): number {
  return (state || ProcessState.STOPPED);
}