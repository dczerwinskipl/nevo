using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Transporting;

[ExcludeFromCodeCoverage]
[AttributeUsage(AttributeTargets.Class, AllowMultiple = false)]
public class MessageTypeAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

[ExcludeFromCodeCoverage]
public class AttributeMessageTypeMapper : IMessageTypeMapper
{
    private readonly ConcurrentDictionary<string, Type> _nameMapping = new();
    private readonly ConcurrentDictionary<Type, string> _typeMapping = new();

    public Option<string> ToName(Type messageType) =>
        _typeMapping.TryGetValue(messageType, out var messageName) ? (Option<string>)messageName : Option<string>.None;

    public Option<Type> ToType(string messageName) =>
        _nameMapping.TryGetValue(messageName, out var messageType) ? (Option<Type>)messageType : Option<Type>.None;
}
