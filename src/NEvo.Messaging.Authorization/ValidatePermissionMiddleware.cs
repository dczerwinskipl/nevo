using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Authorization;

public class ValidatePermissionMiddleware<TId>(IServiceProvider serviceProvider) : IMessageProcessingHandlerMiddleware
{
    // TODO: avoid using IServiceProvider?
    private readonly IServiceProvider _serviceProvider = Check.Null(serviceProvider);

    public Task<Either<Exception, object>> ExecuteAsync(IMessageHandler messageHandler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var allowPermissionAttributes = messageHandler.HandlerDescription.Method?.GetCustomAttributes(typeof(AllowPermissionAttribute), true);
        if (allowPermissionAttributes?.Length > 0 && !IsValid(message, context, allowPermissionAttributes.OfType<AllowPermissionAttribute>()))
        {
            return Task.FromResult(Either<Exception, object>.Left(
                                new Exception("Permission denied")
                            ));
        }

        return next();
    }

    private bool IsValid(IMessage message, IMessageContext context, IEnumerable<AllowPermissionAttribute> allowPermissionAttributes)
    {
        foreach (var allowPermissionAttribute in allowPermissionAttributes)
        {
            if (IsValid(message, context, allowPermissionAttribute))
            {
                return true;
            }
        }

        return false;
    }

    private bool IsValid(IMessage message, IMessageContext context, AllowPermissionAttribute allowPermissionAttribute)
    {
        var validator = (IDataScopeMessageValidator)ActivatorUtilities.CreateInstance(_serviceProvider, allowPermissionAttribute.ValidatorType);
        foreach (var userPermission in context.GetUserContext<TId>().UserPermissions)
        {
            if (validator.Validate(userPermission, message))
            {
                return true;
            }
        }
        return false;
    }
}

