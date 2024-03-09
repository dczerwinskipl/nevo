using System.Collections.Concurrent;
using LanguageExt;

namespace NEvo.Messaging.Transporting;

[AttributeUsage(AttributeTargets.Class, AllowMultiple = false)]
public class MessageTypeAttribute : Attribute
{
    public string Name { get; }

    public MessageTypeAttribute(string name)
    {
        Name = name;
    }
}

public class AttributeMessageTypeMapper : IMessageTypeMapper
{
    private readonly ConcurrentDictionary<string, Type> _nameMapping = new();
    private readonly ConcurrentDictionary<Type, string> _typeMapping = new();

    public AttributeMessageTypeMapper()
    {
        //TODO: create mapping
    }

    public Option<string> ToName(Type messageType) =>
        _typeMapping.TryGetValue(messageType, out var messageName) ? (Option<string>)messageName : Option<string>.None;

    public Option<Type> ToType(string messageName) =>
        _nameMapping.TryGetValue(messageName, out var messageType) ? (Option<Type>)messageType : Option<Type>.None;
}
