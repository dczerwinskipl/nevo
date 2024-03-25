using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling;

[ExcludeFromCodeCoverage]
public class MessageProcessingHandlerMiddlewareConfig(IMessageProcessingHandlerMiddleware middleware, Func<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), bool>? shouldApply = null) : MiddlewareConfig<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>(middleware, shouldApply)
{
}
