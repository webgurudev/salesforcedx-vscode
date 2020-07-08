/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import {
  ExecuteAnonymousResponse,
  ExecuteService
} from '@salesforce/apex-node';
import {
  CancelResponse,
  ContinueResponse,
  ParametersGatherer
} from '@salesforce/salesforcedx-utils-vscode/out/src/types';
import * as vscode from 'vscode';
import { channelService } from '../channels';
import { handleApexLibraryDiagnostics } from '../diagnostics';
import { nls } from '../messages';
import { notificationService } from '../notifications';
import { telemetryService } from '../telemetry';
import { hasRootWorkspace, OrgAuthInfo } from '../util';
import {
  ApexLibraryExecutor,
  SfdxCommandlet,
  SfdxWorkspaceChecker
} from './util';

export class AnonApexGatherer
  implements ParametersGatherer<{ fileName?: string; apexCode?: string }> {
  public async gather(): Promise<
    CancelResponse | ContinueResponse<{ fileName?: string; apexCode?: string }>
  > {
    if (hasRootWorkspace()) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return { type: 'CANCEL' };
      }

      const document = editor.document;
      if (!editor.selection.isEmpty) {
        return {
          type: 'CONTINUE',
          data: { apexCode: document.getText(editor.selection) }
        };
      }

      return { type: 'CONTINUE', data: { fileName: document.uri.fsPath } };
    }
    return { type: 'CANCEL' };
  }
}

const workspaceChecker = new SfdxWorkspaceChecker();
const fileNameGatherer = new AnonApexGatherer();

export class ApexLibraryExecuteExecutor extends ApexLibraryExecutor {
  protected executeService: ExecuteService | undefined;

  public async build(
    execName: string,
    telemetryLogName: string
  ): Promise<void> {
    this.executionName = execName;
    this.telemetryName = telemetryLogName;

    const usernameOrAlias = await OrgAuthInfo.getDefaultUsernameOrAlias(true);
    if (!usernameOrAlias) {
      throw new Error(nls.localize('error_no_default_username'));
    }
    const conn = await OrgAuthInfo.getConnection(usernameOrAlias);
    this.executeService = new ExecuteService(conn);
  }

  public async execute(
    response: ContinueResponse<{ fileName?: string; apexCode?: string }>
  ): Promise<void> {
    this.setStartTime();

    try {
      await this.build(
        nls.localize('apex_execute_text'),
        nls.localize('force_apex_execute_library')
      );

      if (this.executeService === undefined) {
        throw new Error('ExecuteService is not established');
      }

      this.executeService.executeAnonymous = this.executeWrapper(
        this.executeService.executeAnonymous
      );

      await this.executeService.executeAnonymous({
        ...(response.data.fileName && { apexFilePath: response.data.fileName }),
        ...(response.data.apexCode && { apexCode: response.data.apexCode })
      });
    } catch (e) {
      telemetryService.sendException('force_apex_execute_library', e.message);
      notificationService.showFailedExecution(this.executionName);
      channelService.appendLine(e.message);
    }
  }

  public executeWrapper(
    fn: (...args: any[]) => Promise<ExecuteAnonymousResponse>
  ) {
    const commandName = this.executionName;

    return async function(...args: any[]): Promise<ExecuteAnonymousResponse> {
      channelService.showCommandWithTimestamp(`Starting ${commandName}`);

      const result = await vscode.window.withProgress(
        {
          title: commandName,
          location: vscode.ProgressLocation.Notification
        },
        async () => {
          // @ts-ignore
          return (await fn.call(this, ...args)) as ExecuteAnonymousResponse;
        }
      );

      const formattedResult = formatResult(result);
      channelService.appendLine(formattedResult);
      channelService.showCommandWithTimestamp(`Finished ${commandName}`);

      if (result.result.compiled && result.result.success) {
        ApexLibraryExecuteExecutor.errorCollection.clear();
        await notificationService.showSuccessfulExecution(commandName);
      } else {
        const editor = vscode.window.activeTextEditor;
        const document = editor!.document;
        const filePath = args[0].apexFilePath || document.uri.fsPath;

        handleApexLibraryDiagnostics(
          result,
          ApexLibraryExecuteExecutor.errorCollection,
          filePath
        );
        notificationService.showFailedExecution(commandName);
      }

      return result;
    };
  }
}

export function formatResult(
  execAnonResponse: ExecuteAnonymousResponse
): string {
  let outputText: string = '';
  if (execAnonResponse.result.compiled === true) {
    outputText += `${nls.localize('apex_execute_compile_success')}\n`;
    if (execAnonResponse.result.success === true) {
      outputText += `${nls.localize('apex_execute_runtime_success')}\n`;
    } else {
      outputText += `Error: ${execAnonResponse.result.exceptionMessage}\n`;
      outputText += `Error: ${execAnonResponse.result.exceptionStackTrace}\n`;
    }
    outputText += `\n${execAnonResponse.result.logs}`;
  } else {
    outputText += `Error: Line: ${execAnonResponse.result.line}, Column: ${
      execAnonResponse.result.column
    }\n`;
    outputText += `Error: ${execAnonResponse.result.compileProblem}\n`;
  }
  return outputText;
}

export async function forceApexExecute() {
  const commandlet = new SfdxCommandlet(
    workspaceChecker,
    fileNameGatherer,
    new ApexLibraryExecuteExecutor()
  );
  await commandlet.run();
}
