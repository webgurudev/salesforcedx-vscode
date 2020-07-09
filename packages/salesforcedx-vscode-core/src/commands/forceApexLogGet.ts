/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { LogService } from '@salesforce/apex-node';
import { OrgAuthInfo } from '../util/authInfo';

import {
  CliCommandExecutor,
  Command,
  CommandOutput,
  SfdxCommandBuilder
} from '@salesforce/salesforcedx-utils-vscode/out/src/cli';
import {
  getYYYYMMddHHmmssDateFormat,
  optionYYYYMMddHHmmss
} from '@salesforce/salesforcedx-utils-vscode/out/src/date';

import {
  CancelResponse,
  ContinueResponse,
  ParametersGatherer
} from '@salesforce/salesforcedx-utils-vscode/out/src/types';
// import * as fs from 'fs';
import * as path from 'path';
import { Observable } from 'rxjs/Observable';
// import { mkdir } from 'shelljs';
import * as vscode from 'vscode';
// import { CommandExecution } from '../../../salesforcedx-utils-vscode/out/src/cli/commandExecutor';
import { channelService } from '../channels';
import { nls } from '../messages';
import { notificationService, ProgressNotification } from '../notifications';
import { taskViewService } from '../statuses';
import { telemetryService } from '../telemetry';
import { getRootWorkspacePath } from '../util';
import {
  ApexLibraryExecutor,
  SfdxCommandlet,
  // SfdxCommandletExecutor,
  SfdxWorkspaceChecker
} from './util';
// import { ApexLibraryExecutor } from './util/apexCommandlet';

export class GetLogApexGatherer implements ParametersGatherer<{ Id: string }> {
  public async gather(): Promise<
    CancelResponse | ContinueResponse<{ Id: string }>
  > {
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const logInfos = await ForceApexLogList.getLogs(cancellationTokenSource);
    if (logInfos.length > 0) {
      const logItems = logInfos.map(logInfo => {
        const icon = '$(file-text) ';
        const localUTCDate = new Date(logInfo.StartTime);
        const localDateFormatted = localUTCDate.toLocaleDateString(
          undefined,
          optionYYYYMMddHHmmss
        );

        return {
          id: logInfo.Id,
          label: icon + logInfo.LogUser.Name + ' - ' + logInfo.Operation,
          startTime: localDateFormatted,
          detail: localDateFormatted + ' - ' + logInfo.Status.substr(0, 150),
          description: `${(logInfo.LogLength / 1024).toFixed(2)} KB`
        } as ApexDebugLogItem;
      });
      const logItem = await vscode.window.showQuickPick(
        logItems,
        { placeHolder: nls.localize('force_apex_log_get_pick_log_text') },
        cancellationTokenSource.token
      );
      if (logItem) {
        return {
          type: 'CONTINUE',
          data: { Id: logItem.id }
        };
      }
    } else {
      return {
        type: 'CANCEL',
        msg: nls.localize('force_apex_log_get_no_logs_text')
      } as CancelResponse;
    }
    return { type: 'CANCEL' };
  }
}

const workspaceChecker = new SfdxWorkspaceChecker();
const parameterGatherer = new GetLogApexGatherer();

export class ApexLibraryGetLogsExecutor extends ApexLibraryExecutor {
  protected logService: LogService | undefined;

  public async build(
    executionName: string,
    telemetryName: string
  ): Promise<void> {
    this.executionName = executionName;
    this.telemetryName = telemetryName;

    const usernameOrAlias = await OrgAuthInfo.getDefaultUsernameOrAlias(true);
    if (!usernameOrAlias) {
      throw new Error(nls.localize('error_no_default_username'));
    }
    const conn = await OrgAuthInfo.getConnection(usernameOrAlias);
    this.logService = new LogService(conn);
  }

  public async execute(
    response: ContinueResponse<{ Id: string }>
  ): Promise<void> {
    try {
      await this.build(
        nls.localize('apex_log_get_text'),
        nls.localize('force_apex_log_get_library')
      );

      if (this.logService === undefined) {
        throw new Error('Log Service is not established.');
      }

      this.logService.getLogs = this.getLogsWrapper(this.logService.getLogs);
      const logDir = path.join(
        getRootWorkspacePath(),
        '.sfdx',
        'tools',
        'debug',
        'logs'
      );

      await this.logService.getLogs({
        ...(response.data.Id && { logId: response.data.Id }),
        ...(logDir && { outputDir: logDir })
      });
    } catch (e) {
      telemetryService.sendException(
        nls.localize('force_apex_log_get_library'),
        e.message
      );
      notificationService.showFailedExecution(this.executionName!);
      channelService.appendLine(e.message);
    }
  }

  public getLogsWrapper(fn: (...args: any[]) => Promise<string[]>) {
    const commandName = this.executionName;

    return async function(...args: any[]): Promise<string[]> {
      channelService.showCommandWithTimestamp(`Starting ${commandName}`);

      const result = await vscode.window.withProgress(
        {
          title: commandName,
          location: vscode.ProgressLocation.Notification
        },
        async () => {
          // @ts-ignore
          return (await fn.call(this, ...args)) as string[];
        }
      );

      channelService.showCommandWithTimestamp(`Finished ${commandName}`);

      const logPath = path.join(`${args[0].outputDir}`, `${args[0].logId}.txt`);
      const document = await vscode.workspace.openTextDocument(logPath);
      vscode.window.showTextDocument(document);

      // Notification successful message

      return result;
    };
  }
}

// export class ForceApexLogGetExecutor extends SfdxCommandletExecutor<
//   ApexDebugLogIdStartTime
// > {
//   public build(data: ApexDebugLogIdStartTime): Command {
//     return new SfdxCommandBuilder()
//       .withDescription(nls.localize('force_apex_log_get_text'))
//       .withArg('force:apex:log:get')
//       .withFlag('--logid', data.id)
//       .withJson()
//       .withLogName('force_apex_log_get')
//       .build();
//   }

// protected attachExecution(
//   execution: CommandExecution,
//   cancellationTokenSource: vscode.CancellationTokenSource,
//   cancellationToken: vscode.CancellationToken
// ) {
//   channelService.streamCommandStartStop(execution);
//   notificationService.reportCommandExecutionStatus(
//     execution,
//     cancellationToken
//   );
//   ProgressNotification.show(execution, cancellationTokenSource);
//   taskViewService.addCommandExecution(execution, cancellationTokenSource);
// }

// public async execute(
//   response: ContinueResponse<ApexDebugLogIdStartTime>
// ): Promise<void> {
//   const usernameOrAlias = await OrgAuthInfo.getDefaultUsernameOrAlias(true);
//   if (!usernameOrAlias) {
//     throw new Error(nls.localize('error_no_default_username'));
//   }
//   const conn = await OrgAuthInfo.getConnection(usernameOrAlias);
//   const apexService = new LogService(conn);
//   const logs = await apexService.getLogs({
//     numberOfLogs: 2
//   });
//   console.log(logs);

/*const startTime = process.hrtime();
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const cancellationToken = cancellationTokenSource.token;
    const execution = new CliCommandExecutor(this.build(response.data), {
      cwd: getRootWorkspacePath()
    }).execute(cancellationToken);
    this.attachExecution(execution, cancellationTokenSource, cancellationToken);

    execution.processExitSubject.subscribe(() => {
      this.logMetric(execution.command.logName, startTime);
    });

    const result = await new CommandOutput().getCmdResult(execution);
    const resultJson = JSON.parse(result);
    if (resultJson.status === 0) {
      const logDir = path.join(
        getRootWorkspacePath(),
        '.sfdx',
        'tools',
        'debug',
        'logs'
      );
      if (!fs.existsSync(logDir)) {
        mkdir('-p', logDir);
      }

      const localUTCDate = new Date(response.data.startTime);
      const date = getYYYYMMddHHmmssDateFormat(localUTCDate);
      const logPath = path.join(logDir, `${response.data.id}_${date}.log`);
      fs.writeFileSync(logPath, resultJson.result.log);
      const document = await vscode.workspace.openTextDocument(logPath);
      vscode.window.showTextDocument(document);
    }
  }*/
// }

export type ApexDebugLogIdStartTime = {
  id: string;
  startTime: string;
};

export type ApexDebugLogUser = {
  Name: string;
};

export type ApexDebugLogObject = {
  Id: string;
  StartTime: string;
  LogLength: number;
  Operation: string;
  Request: string;
  Status: string;
  LogUser: ApexDebugLogUser;
};

interface ApexDebugLogItem extends vscode.QuickPickItem {
  id: string;
  startTime: string;
}

export class ForceApexLogList {
  public static async getLogs(
    cancellationTokenSource: vscode.CancellationTokenSource
  ): Promise<ApexDebugLogObject[]> {
    const execution = new CliCommandExecutor(
      new SfdxCommandBuilder()
        .withDescription(nls.localize('force_apex_log_list_text'))
        .withArg('force:apex:log:list')
        .withJson()
        .withLogName('force_apex_log_list')
        .build(),
      { cwd: getRootWorkspacePath() }
    ).execute();
    ProgressNotification.show(execution, cancellationTokenSource);
    taskViewService.addCommandExecution(execution, cancellationTokenSource);
    notificationService.reportExecutionError(
      execution.command.toString(),
      (execution.processErrorSubject as any) as Observable<Error | undefined>
    );
    const cmdOutput = new CommandOutput();
    const result = await cmdOutput.getCmdResult(execution);
    try {
      const apexDebugLogObjects: ApexDebugLogObject[] = JSON.parse(result)
        .result;
      apexDebugLogObjects.sort((a, b) => {
        return (
          new Date(b.StartTime).valueOf() - new Date(a.StartTime).valueOf()
        );
      });
      return Promise.resolve(apexDebugLogObjects);
    } catch (e) {
      return Promise.reject(e);
    }
  }
}

export async function forceApexLogGet() {
  const commandlet = new SfdxCommandlet(
    workspaceChecker,
    parameterGatherer,
    new ApexLibraryGetLogsExecutor()
  );
  await commandlet.run();
}
