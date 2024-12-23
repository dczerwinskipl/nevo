using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Authorization;

public interface IDataScopeMessageValidator
{
    bool Validate(IPermission permission, IMessage message);
}

public interface IDataScopeMessageValidator<TDataScope, TMessage> : IDataScopeMessageValidator
    where TDataScope : AuthDataScope
    where TMessage : Message
{
    bool Validate(TDataScope dataScope, TMessage message);
    bool IDataScopeMessageValidator.Validate(IPermission permission, IMessage message)
    {
        if (permission is not Permission<TDataScope> typedPermission || message is not TMessage typedMessage)
        {
            return false;
        }

        return Validate(typedPermission.DataScope, typedMessage);
    }
}