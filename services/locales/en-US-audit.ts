/** Employee audit viewer terminology; existing reviewed terms retain precedence. */
export const auditEnglish:Record<string,string>={
  '复制操作编号':'Copy operation ID','操作编号':'Operation ID','已复制':'Copied','Agent 提议':'Agent proposal','文件夹':'Folder',
  // Agent proposal confirmation (high-risk detail and password re-check).
  '确认 Agent 提议':'Confirm Agent proposal','将要改动的字段':'Fields to change','收款账户':'Payee account','原':'Current','核实记录':'Verification record','SWIFT':'SWIFT',
  '执行身份':'Acting as','稍后':'Later','没有执行':'Not executed','本人登录密码':'Your sign-in password','原文依据':'Source quote',
  '低风险':'Low risk','中风险':'Medium risk','高风险':'High risk','开户行地址':'Bank address',
  '另有 {0} 项未显示':'{0} more items not shown','内容过多，无法在此完整核对':'Too much content to review here',
  '请拒绝后让 Agent 拆成较小的操作重新提交':'Reject it and ask the Agent to resubmit as smaller actions',
  '付款、核销、审批、作废等资金或不可逆操作，确认前须重新验证本人密码':'Payments, write-offs, approvals, voids and other irreversible actions require your password before confirming',
  '有操作记录暂不可读取':'Some activity records are temporarily unavailable',
  '记录暂不可用':'Records temporarily unavailable',
  '人工确认':'Human confirmation','人工拒绝':'Human rejection',
  '原始填写':'Original input','隐藏原始填写':'Hide original input',
  '最终结算':'Final settlement','建议预付抵扣':'Suggested advance offset','抵扣调整原因':'Offset adjustment reason','确认记录':'Confirmation','争议':'Disputes','提交人':'Submitted by',
  '打开原单':'Open source record','相关来源':'Related records',
  'Agent 操作记录':'Agent activity','操作记录范围':'Activity scope','本人操作':'My activity','公司操作':'Company activity','操作类型':'Action type','全部经办人':'All operators','未命名账号':'Unnamed account',
  'Agent 办理':'Agent action','提交提议':'Proposal submitted','本人确认':'Human confirmation','本人拒绝':'Human rejection','操作记录读取失败':'Could not load activity','查看本人':'View my activity','没有符合条件的操作':'No matching activity','暂无 Agent 操作记录':'No Agent activity yet',
  '操作详情':'Action details','操作详情读取失败':'Could not load action details','可见范围已更新，请重新读取':'Visibility has changed. Reload the details.','更多变更':'More changes','同一提议':'Same proposal','同一会话':'Same session','清除关联':'Clear relation','同一提议的操作':'Actions for this proposal','同一会话的操作':'Actions in this session',
  '实际变更':'Committed changes','部分明细受当前权限限制':'Some details are restricted by your current access','当前权限下没有可显示的变更':'No changes visible with your current access','此次仅提交提议':'This action only submitted a proposal','未改变业务内容':'No business content changed','部分可见':'Partially visible','受当前权限限制':'Restricted by current access','已隐藏敏感内容':'Sensitive content hidden','关联记录':'Related record','修改前':'Before','修改后':'After','补充信息':'Additional information','未设置':'Not set','空':'Empty',
};
