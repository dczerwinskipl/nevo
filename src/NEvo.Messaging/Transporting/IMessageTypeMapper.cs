namespace NEvo.Messaging.Transporting;

public interface IMessageTypeMapper
{
    Option<string> ToName(Type messageType);
    Option<string> ToName<TMessage>() where TMessage : IMessage => ToName(typeof(TMessage));
    Option<Type> ToType(string messageName);
}

public class DefaultMessageTypeMapper : IMessageTypeMapper
{
    Option<string> IMessageTypeMapper.ToName(Type messageType)
    {
        return $"{messageType.FullName}, {messageType.Assembly.GetName().Name}";
    }

    Option<Type> IMessageTypeMapper.ToType(string messageName)
    {
        var type = Type.GetType(messageName);
        if (type is null)
        {
            return Option<Type>.None;
        }

        return type;
    }
}