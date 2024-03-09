using LanguageExt;

namespace NEvo.Messaging.Transporting;

public interface IMessageTypeMapper
{
    Option<string> ToName(Type messageType);
    Option<string> ToName<TMessage>() where TMessage : IMessage => ToName(typeof(TMessage));
    Option<Type> ToType(string messageName);
}