using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling;

[ExcludeFromCodeCoverage]
public class MessageProcessingMiddlewareConfig(IMessageProcessingMiddleware middleware, Func<(IMessage message, IMessageContext), bool>? shouldApply = null) : MiddlewareConfig<(IMessage message, IMessageContext), Either<Exception, object>>(middleware, shouldApply)
{
}
